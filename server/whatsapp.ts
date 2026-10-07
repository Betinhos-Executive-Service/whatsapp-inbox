import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  proto,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import type { Chat, IncomingMessage, Message, Store } from "./db.ts";
import { extractAction, extractMedia, extractQuote, extractText, type Action } from "./text.ts";

export type ConnectionStatus = "iniciando" | "qr" | "conectado" | "reconectando" | "desconectado";
export type ConnectionState = { status: ConnectionStatus; qr: string | null; me: string | null; error: string | null };

/** Mensagem com até 2 min de idade conta como "ao vivo": mexe em não lidas e status. */
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const logger = pino({ level: "silent" });

/** Conversas individuais e grupos; status, listas e canais ficam de fora. */
function isConversation(jid: string | null | undefined): jid is string {
  return !!jid && (isPnUser(jid) || isLidUser(jid) || isJidGroup(jid)) === true;
}

export type OutgoingFile = { body: Buffer; mimetype: string; fileName: string; caption?: string; ptt?: boolean; seconds?: number };

export class WhatsApp extends EventEmitter<{
  connection: [ConnectionState];
  message: [{ message: Message; chat: Chat; live: boolean }];
  chat: [Chat];
  /** Mensagem já existente mudou: status de entrega, edição, apagada ou reação. */
  update: [{ message: Message; chat: Chat | null }];
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
    if (isJidGroup(raw)) return raw;
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

  /** `quiet`: lote do histórico; a tela recarrega uma vez no fim, sem um evento por mensagem. */
  private ingest(m: WAMessage, live: boolean, quiet = false) {
    const raw = m.key.remoteJid;
    if (!isConversation(raw) || !m.key.id || !m.message) return;
    const content = normalizeMessageContent(m.message);
    const action = extractAction(content);
    if (action) return this.applyAction(this.canonical(raw, m.key.remoteJidAlt), action, m);
    const extracted = extractText(content);
    const media = extractMedia(content);
    if (!extracted) return;
    const at = Number(m.messageTimestamp ?? 0) * 1000 || Date.now();
    const chatJid = this.canonical(raw, m.key.remoteJidAlt);
    const group = isJidGroup(raw) === true;
    // Em grupo, o autor vai no início do texto: "Nome: mensagem".
    const author = group && !m.key.fromMe ? this.authorName(m) : null;
    const incoming: IncomingMessage = {
      chatJid,
      id: m.key.id,
      rawJid: raw,
      participant: group ? (m.key.participant ?? null) : null,
      fromMe: !!m.key.fromMe,
      at,
      text: author ? `${author}: ${extracted.text}` : extracted.text,
      kind: extracted.kind,
      media: media ? JSON.stringify(media) : null,
      quoted: extractQuote(content),
      ack: m.key.fromMe ? (m.status ?? null) : null,
    };
    const isLive = live && Date.now() - at < LIVE_WINDOW_MS;
    // Enviada agora: guarda o proto para reenviar se o WhatsApp do contato pedir retry.
    if (isLive && m.key.fromMe) incoming.raw = proto.Message.encode(m.message).finish();
    if (quiet) {
      // Lote do histórico: só grava; a tela recarrega uma vez no fim, então não lê nada de volta.
      this.store.insertMessage(incoming, isLive);
      if (!group && !m.key.fromMe && m.pushName) this.store.setNames(chatJid, { push: m.pushName });
      return;
    }
    const result = this.store.addMessage(incoming, isLive);
    if (!group && !m.key.fromMe && m.pushName) this.store.setNames(chatJid, { push: m.pushName });
    if (result) this.emit("message", { ...result, chat: this.store.getChat(chatJid)!, live: isLive });
  }

  /** Apagar para todos, editar e reagir mudam uma mensagem já guardada. */
  private applyAction(chatJid: string, action: Action, m: WAMessage) {
    const at = Number(m.messageTimestamp ?? 0) * 1000 || Date.now();
    if (action.type === "reaction") {
      const sender = m.key.fromMe ? "me" : (m.key.participant ?? chatJid);
      const message = this.store.setReaction(chatJid, action.id, sender, action.emoji, at);
      if (message) this.emit("update", { message, chat: null });
      return;
    }
    const result = action.type === "revoke"
      ? this.store.revokeMessage(chatJid, action.id, at)
      : this.store.editMessage(chatJid, action.id, action.text, at);
    if (result) this.emit("update", result);
  }

  /** Nome do autor em grupo: agenda, depois nome do perfil, depois número. */
  private authorName(m: WAMessage): string {
    const raw = m.key.participantAlt && isPnUser(m.key.participantAlt) ? m.key.participantAlt : m.key.participant;
    if (!raw) return m.pushName || "Participante";
    const jid = this.canonical(raw, m.key.participantAlt);
    if (!isJidGroup(jid)) {
      const known = this.store.contactName(jid);
      if (known) return known;
    }
    return m.pushName || (isPnUser(jid) ? `+${jid.split("@")[0]}` : "Participante");
  }

  private setGroupName(jid: string | undefined, subject: string | undefined) {
    if (!jid || !subject || !isJidGroup(jid)) return;
    if (!this.store.setNames(jid, { saved: subject })) return;
    const chat = this.store.getChat(jid);
    if (chat && chat.lastAt > 0) this.emit("chat", chat);
  }

  /** Busca os nomes de todos os grupos de que o número participa. Só leitura. */
  private async loadGroups(sock: WASocket) {
    try {
      const groups = await sock.groupFetchAllParticipating();
      for (const g of Object.values(groups)) this.setGroupName(g.id, g.subject);
    } catch (error) {
      process.stderr.write(`[whatsapp] grupos não carregaram: ${error instanceof Error ? error.message : error}
`);
    }
  }

  /**
   * Versão do WhatsApp Web a anunciar. A consulta ao GitHub ficava no caminho da conexão
   * (segundos sem internet boa); agora vale a última conhecida e a nova fica para a próxima vez.
   */
  private async waVersion(): Promise<[number, number, number] | undefined> {
    const cached = this.store.getSetting("wa_version");
    const refresh = fetchLatestBaileysVersion()
      .then((r) => {
        if (r.isLatest) this.store.setSetting("wa_version", JSON.stringify(r.version));
        return r.version as [number, number, number];
      })
      .catch(() => undefined);
    if (cached) {
      try {
        return JSON.parse(cached) as [number, number, number];
      } catch {
        this.store.setSetting("wa_version", null);
      }
    }
    // Primeira vez: espera no máximo 4 s; sem resposta, usa a versão embutida na biblioteca.
    return Promise.race([refresh, new Promise<undefined>((r) => setTimeout(r, 4000, undefined).unref())]);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.setState({ status: this.retries ? "reconectando" : "iniciando", qr: null, error: null });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    // Sessão salva de outro número (ex.: data/auth trocado): separa antes de qualquer evento.
    if (state.creds.me?.id) this.checkAccount(jidNormalizedUser(state.creds.me.id));
    const version = await this.waVersion();
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: Browsers.windows("Desktop"),
      // Sem "online": o celular continua recebendo notificações normalmente.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      // Pedido de retry: o contato não decifrou a mensagem e pede o conteúdo de novo.
      getMessage: async (key) => {
        const raw = key.id ? this.store.rawMessage(key.id) : null;
        return raw ? proto.Message.decode(raw) : undefined;
      },
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
        void this.loadGroups(sock);
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
      // Uma transação para o lote inteiro: milhares de gravações sem um commit (fsync) cada.
      this.store.tx(() => {
        for (const map of lidPnMappings ?? []) this.learnLid(map.lid, map.pn);
        for (const c of chats) {
          if (!isConversation(c.id)) continue;
          const jid = this.canonical(c.id, c.pnJid);
          const unread = Number(c.unreadCount ?? 0);
          this.store.ensureChat(jid, { status: unread > 0 ? "aberta" : "resolvida", unread: Math.max(0, unread) });
          if (c.name) this.store.setNames(jid, { saved: c.name });
        }
        for (const contact of contacts) this.applyContact(contact);
        for (const m of messages) this.ingest(m, false, true);
      });
      this.emit("reload");
    });

    sock.ev.on("groups.upsert", (list) => list.forEach((g) => this.setGroupName(g.id, g.subject)));
    sock.ev.on("groups.update", (list) => list.forEach((g) => this.setGroupName(g.id, g.subject)));
    sock.ev.on("lid-mapping.update", (map) => this.learnLid(map.lid, map.pn));
    sock.ev.on("contacts.upsert", (list) => list.forEach((c) => this.applyContact(c)));
    sock.ev.on("contacts.update", (list) => list.forEach((c) => this.applyContact(c)));
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const m of messages) this.ingest(m, type === "notify" || type === "append");
    });
    // Recibos das minhas mensagens: entregue, lida, ouvida.
    sock.ev.on("messages.update", (list) => {
      for (const { key, update } of list) {
        if (!key.fromMe || !key.id || typeof update.status !== "number" || !isConversation(key.remoteJid)) continue;
        const message = this.store.setAck(this.canonical(key.remoteJid, key.remoteJidAlt), key.id, update.status);
        if (message) this.emit("update", { message, chat: null });
      }
    });
  }

  private applyContact(c: { id?: string; lid?: string; phoneNumber?: string; name?: string; notify?: string; verifiedName?: string }) {
    if (!c.id) return;
    if (c.lid && c.phoneNumber) this.learnLid(jidNormalizedUser(c.lid), jidNormalizedUser(c.phoneNumber));
    const raw = c.phoneNumber ?? c.id;
    if (!isConversation(raw) || isJidGroup(raw)) return;
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

  private connectedSock(): WASocket {
    if (!this.sock || this.state.status !== "conectado") throw new Error("O WhatsApp não está conectado.");
    return this.sock;
  }

  /** Mensagem guardada no formato que o Baileys usa para citar. */
  private quotedMessage(jid: string, id: string | undefined): WAMessage | undefined {
    if (!id) return undefined;
    const key = this.store.messageKey(jid, id);
    if (!key) throw new Error("A mensagem citada não foi encontrada.");
    return {
      key: { remoteJid: key.rawJid, id, fromMe: key.fromMe, ...(key.participant ? { participant: key.participant } : {}) },
      message: { conversation: this.store.messageText(jid, id) ?? "" },
    };
  }

  async send(jid: string, text: string, quotedId?: string): Promise<void> {
    const sock = this.connectedSock();
    const sent = await sock.sendMessage(jid, { text }, { quoted: this.quotedMessage(jid, quotedId) });
    if (sent) this.ingest(sent, true);
  }

  /** Emoji vazio tira a reação. */
  async react(jid: string, id: string, emoji: string): Promise<void> {
    const sock = this.connectedSock();
    const key = this.store.messageKey(jid, id);
    if (!key) throw new Error("Mensagem não encontrada.");
    await sock.sendMessage(jid, {
      react: { text: emoji, key: { remoteJid: key.rawJid, id, fromMe: key.fromMe, ...(key.participant ? { participant: key.participant } : {}) } },
    });
    const message = this.store.setReaction(jid, id, "me", emoji);
    if (message) this.emit("update", { message, chat: null });
  }

  /** Envia anexo; o tipo da mensagem (imagem, vídeo, voz, documento) sai do mimetype. Devolve o id enviado. */
  async sendMedia(jid: string, file: OutgoingFile, quotedId?: string): Promise<string | null> {
    const sock = this.connectedSock();
    const { body, fileName } = file;
    const caption = file.caption?.trim() || undefined;
    const base = file.mimetype.split(";")[0];
    const content = file.ptt
      ? { audio: body, ptt: true, mimetype: "audio/ogg; codecs=opus", ...(file.seconds ? { seconds: Math.round(file.seconds) } : {}) }
      : base.startsWith("image/") && base !== "image/gif" && base !== "image/svg+xml"
        ? { image: body, mimetype: base, caption }
        : base === "video/mp4"
          ? { video: body, mimetype: base, caption }
          : base.startsWith("audio/")
            ? { audio: body, mimetype: base }
            : { document: body, mimetype: base || "application/octet-stream", fileName, caption };
    const sent = await sock.sendMessage(jid, content, { quoted: this.quotedMessage(jid, quotedId) });
    if (!sent) return null;
    this.ingest(sent, true);
    return sent.key.id ?? null;
  }

  async markRead(keys: { id: string; rawJid: string; participant: string | null }[]): Promise<void> {
    if (!this.sock || !keys.length) return;
    await this.sock.readMessages(
      keys.map((k) => ({ remoteJid: k.rawJid, id: k.id, fromMe: false, ...(k.participant ? { participant: k.participant } : {}) })),
    );
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
