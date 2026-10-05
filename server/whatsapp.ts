import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import type { Chat, IncomingMessage, Message, Store } from "./db.ts";
import { extractMedia, extractText } from "./text.ts";

export type ConnectionStatus = "iniciando" | "qr" | "conectado" | "reconectando" | "desconectado";
export type ConnectionState = { status: ConnectionStatus; qr: string | null; me: string | null; error: string | null };

/** Mensagem com até 2 min de idade conta como "ao vivo": mexe em não lidas e status. */
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const logger = pino({ level: "silent" });

/** Só conversas individuais: grupos, status, listas e canais ficam de fora. */
function isPersonal(jid: string | null | undefined): jid is string {
  return !!jid && (isPnUser(jid) || isLidUser(jid)) === true;
}

export class WhatsApp extends EventEmitter<{
  connection: [ConnectionState];
  message: [{ message: Message; chat: Chat; live: boolean }];
  chat: [Chat];
  reload: [];
}> {
  state: ConnectionState = { status: "iniciando", qr: null, me: null, error: null };
  private sock: WASocket | null = null;
  private retries = 0;
  private stopped = false;
  private readonly store: Store;
  private readonly authDir: string;

  constructor(store: Store, authDir: string) {
    super();
    this.store = store;
    this.authDir = authDir;
  }

  private setState(patch: Partial<ConnectionState>) {
    this.state = { ...this.state, ...patch };
    this.emit("connection", this.state);
  }

  /** Converte o JID bruto no JID da conversa: número quando conhecido, senão o LID. */
  private canonical(raw: string, alt?: string | null): string {
    if (isPnUser(raw)) return jidNormalizedUser(raw);
    if (alt && isPnUser(alt)) {
      const pn = jidNormalizedUser(alt);
      this.learnLid(jidNormalizedUser(raw), pn);
      return pn;
    }
    return this.store.pnForLid(jidNormalizedUser(raw)) ?? jidNormalizedUser(raw);
  }

  /** Outro número no QR = outra caixa de entrada: as conversas do número anterior saem. */
  private checkAccount(me: string | null) {
    if (!me || !isPnUser(me)) return;
    if (this.store.switchAccount(me.split("@")[0])) this.emit("reload");
  }

  private learnLid(lid: string, pn: string) {
    if (!isLidUser(lid) || !isPnUser(pn) || this.store.pnForLid(lid) === pn) return;
    const merged = this.store.mapLid(lid, pn);
    if (merged) this.emit("chat", merged);
  }

  private ingest(m: WAMessage, live: boolean) {
    const raw = m.key.remoteJid;
    if (!isPersonal(raw) || !m.key.id || !m.message) return;
    const content = normalizeMessageContent(m.message);
    const extracted = extractText(content);
    const media = extractMedia(content);
    if (!extracted) return;
    const at = Number(m.messageTimestamp ?? 0) * 1000 || Date.now();
    const chatJid = this.canonical(raw, m.key.remoteJidAlt);
    const incoming: IncomingMessage = {
      chatJid,
      id: m.key.id,
      rawJid: raw,
      fromMe: !!m.key.fromMe,
      at,
      text: extracted.text,
      kind: extracted.kind,
      media: media ? JSON.stringify(media) : null,
    };
    const isLive = live && Date.now() - at < LIVE_WINDOW_MS;
    const result = this.store.addMessage(incoming, isLive);
    if (!m.key.fromMe && m.pushName) this.store.setNames(chatJid, { push: m.pushName });
    if (result) this.emit("message", { ...result, chat: this.store.getChat(chatJid)!, live: isLive });
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.setState({ status: this.retries ? "reconectando" : "iniciando", qr: null, error: null });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    // Sessão salva de outro número (ex.: data/auth trocado): separa antes de qualquer evento.
    if (state.creds.me?.id) this.checkAccount(jidNormalizedUser(state.creds.me.id));
    const version = await fetchLatestBaileysVersion()
      .then((r) => r.version)
      .catch(() => undefined);
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: Browsers.windows("Desktop"),
      // Sem "online": o celular continua recebendo notificações normalmente.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    this.sock = sock;

    sock.ev.on("creds.update", (update) => {
      // Logo depois de ler o QR o número já é conhecido, antes do histórico chegar.
      if (update.me?.id) this.checkAccount(jidNormalizedUser(update.me.id));
      void saveCreds();
    });

    sock.ev.on("connection.update", async (u) => {
      if (u.qr) {
        this.setState({ status: "qr", qr: await QRCode.toDataURL(u.qr, { margin: 1, width: 280 }) });
      }
      if (u.connection === "open") {
        this.retries = 0;
        const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
        this.checkAccount(me);
        this.setState({ status: "conectado", qr: null, error: null, me });
        // Depois do histórico inicial; numa reconexão comum é só uma consulta à configuração.
        setTimeout(() => void this.backfillContacts(sock), 20000);
      }
      if (u.connection === "close") {
        if (this.sock !== sock) return;
        this.sock = null;
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (this.stopped) return;
        if (code === DisconnectReason.loggedOut) {
          // Aparelho desconectado no celular: limpa a sessão e mostra QR novo.
          await rm(this.authDir, { recursive: true, force: true });
          this.retries = 0;
          this.setState({ status: "desconectado", me: null, error: "O aparelho foi desconectado no celular." });
          void this.start();
          return;
        }
        this.retries++;
        const wait = Math.min(30000, 1000 * 2 ** Math.min(this.retries - 1, 5));
        this.setState({ status: "reconectando", error: u.lastDisconnect?.error?.message ?? null });
        setTimeout(() => void this.start().catch((e) => this.setState({ status: "desconectado", error: String(e) })), wait);
      }
    });

    sock.ev.on("messaging-history.set", ({ chats, contacts, messages, lidPnMappings }) => {
      for (const map of lidPnMappings ?? []) this.learnLid(map.lid, map.pn);
      for (const c of chats) {
        if (!isPersonal(c.id)) continue;
        const jid = this.canonical(c.id, c.pnJid);
        const unread = Number(c.unreadCount ?? 0);
        this.store.ensureChat(jid, { status: unread > 0 ? "aberta" : "resolvida", unread: Math.max(0, unread) });
        if (c.name) this.store.setNames(jid, { saved: c.name });
      }
      for (const contact of contacts) this.applyContact(contact);
      for (const m of messages) this.ingest(m, false);
      this.emit("reload");
    });

    sock.ev.on("lid-mapping.update", (map) => this.learnLid(map.lid, map.pn));
    sock.ev.on("contacts.upsert", (list) => list.forEach((c) => this.applyContact(c)));
    sock.ev.on("contacts.update", (list) => list.forEach((c) => this.applyContact(c)));
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const m of messages) this.ingest(m, type === "notify" || type === "append");
    });
  }

  private applyContact(c: { id?: string; lid?: string; phoneNumber?: string; name?: string; notify?: string; verifiedName?: string }) {
    if (!c.id) return;
    if (c.lid && c.phoneNumber) this.learnLid(jidNormalizedUser(c.lid), jidNormalizedUser(c.phoneNumber));
    const raw = c.phoneNumber ?? c.id;
    if (!isPersonal(raw)) return;
    const jid = this.canonical(raw);
    const changed = this.store.setNames(jid, { saved: c.name, push: c.notify ?? c.verifiedName });
    const chat = changed ? this.store.getChat(jid) : null;
    if (chat && chat.lastAt > 0) this.emit("chat", chat);
  }

  /**
   * Uma vez por instalação: pede de novo ao WhatsApp a agenda completa (coleção de contatos
   * do app state). Recupera nomes que chegaram antes de a conversa existir. Só leitura.
   */
  private async backfillContacts(sock: WASocket) {
    if (this.store.getSetting("contacts_backfill") === "1") return;
    try {
      await sock.authState.keys.set({ "app-state-sync-version": { critical_unblock_low: null } });
      await sock.resyncAppState(["critical_unblock_low"], true);
      this.store.setSetting("contacts_backfill", "1");
      this.emit("reload");
    } catch (error) {
      process.stderr.write(`[whatsapp] agenda não sincronizou: ${error instanceof Error ? error.message : error}\n`);
    }
  }

  async send(jid: string, text: string): Promise<void> {
    if (!this.sock || this.state.status !== "conectado") throw new Error("O WhatsApp não está conectado.");
    const sent = await this.sock.sendMessage(jid, { text });
    if (sent) this.ingest(sent, true);
  }

  async markRead(keys: { id: string; rawJid: string }[]): Promise<void> {
    if (!this.sock || !keys.length) return;
    await this.sock.readMessages(keys.map((k) => ({ remoteJid: k.rawJid, id: k.id, fromMe: false })));
  }

  /** Desconecta este aparelho do WhatsApp e volta a mostrar o QR. */
  async logout(): Promise<void> {
    this.stopped = true;
    const sock = this.sock;
    this.sock = null;
    await sock?.logout().catch(() => undefined);
    await rm(this.authDir, { recursive: true, force: true });
    this.setState({ status: "desconectado", me: null, qr: null, error: null });
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.sock?.end(undefined);
    this.sock = null;
  }
}
