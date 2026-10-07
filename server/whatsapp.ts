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
import type { Chat, IncomingMessage, Message, MessageKeyRef, QuotedRef, Store } from "./db.ts";
import { extractAction, extractContext, extractMedia, extractText, revokedId, sentChangeError, viewOnceText, type Action } from "./text.ts";

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
/** Resposta a uma mensagem (citação) e menções com @. */
export type SendOptions = { quoted?: MessageKeyRef | null; mentions?: string[]; mentionAll?: boolean };

export type Participant = { jid: string; name: string; phone: string | null; admin: boolean; me: boolean };
export type Profile = {
  about: string | null;
  aboutAt: number | null;
  group: { subject: string; description: string | null; createdAt: number | null; size: number; participants: Participant[] } | null;
};

/** Em grupo, o texto salvo começa com "Autor: "; na citação vai só o conteúdo. */
function quoteText(ref: MessageKeyRef): string {
  if (!ref.participant || ref.fromMe) return ref.text;
  const i = ref.text.indexOf(": ");
  return i > 0 && i <= 60 ? ref.text.slice(i + 2) : ref.text;
}

export class WhatsApp extends EventEmitter<{
  connection: [ConnectionState];
  message: [{ message: Message; chat: Chat; live: boolean }];
  /** Mensagem existente mudou: apagada para todos, editada, reação ou status de entrega. */
  update: [{ message: Message; chat: Chat }];
  chat: [Chat];
  /** Contato digitando ou gravando áudio; null = parou. */
  presence: [{ jid: string; state: "composing" | "recording" | null }];
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

  /** O JID (número ou LID) é deste aparelho? */
  private isMe(jid: string | null | undefined): boolean {
    const me = this.sock?.user;
    if (!jid || !me) return false;
    const n = jidNormalizedUser(jid);
    return n === jidNormalizedUser(me.id) || (!!me.lid && n === jidNormalizedUser(me.lid));
  }

  /** Nome de um participante (número ou LID): agenda/perfil, depois número; null se desconhecido. */
  private nameOf(raw: string, alt?: string | null): string | null {
    if (this.isMe(raw)) return "Você";
    const jid = this.canonical(raw, alt);
    return this.store.contactName(jid) ?? (isPnUser(jid) ? `+${jid.split("@")[0]}` : null);
  }

  /** "@5511…" ou "@<lid>" no texto viram "@Nome" quando o contato é conhecido. */
  private resolveMentions(text: string, mentions: string[]): string {
    let out = text;
    for (const jid of mentions) {
      const user = jid.split("@")[0];
      const name = this.nameOf(jid);
      if (user && name) out = out.split(`@${user}`).join(`@${name.replace(/^\+/, "")}`);
    }
    return out;
  }

  private quoteRef(chatJid: string, q: { id: string; participant: string | null; text: string }, group: boolean): QuotedRef {
    const saved = this.store.getMessage(chatJid, q.id);
    const fromMe = saved?.fromMe ?? this.isMe(q.participant);
    const author = fromMe ? null : group && q.participant ? this.nameOf(q.participant) : null;
    return { id: q.id, text: q.text, fromMe, author };
  }

  /** `quiet`: lote do histórico; a tela recarrega uma vez no fim, sem um evento por mensagem. */
  private ingest(m: WAMessage, live: boolean, quiet = false) {
    const raw = m.key.remoteJid;
    // Visualização única chega sem conteúdo em aparelho conectado; só marca que existe.
    const viewOnce = !!m.key.isViewOnce && !m.message;
    if (!isConversation(raw) || !m.key.id || (!m.message && !viewOnce)) return;
    const content = normalizeMessageContent(m.message);
    const revoked = revokedId(content);
    if (revoked) {
      const chatJid = this.canonical(raw, m.key.remoteJidAlt);
      const message = this.store.markRevoked(chatJid, revoked);
      if (message && !quiet) this.emit("update", { message, chat: this.store.getChat(chatJid)! });
      return;
    }
    const action = extractAction(content);
    if (action) return this.applyAction(this.canonical(raw, m.key.remoteJidAlt), action, m, quiet);
    const extracted = viewOnce ? viewOnceText() : extractText(content);
    const media = viewOnce ? null : extractMedia(content);
    if (!extracted) return;
    const at = Number(m.messageTimestamp ?? 0) * 1000 || Date.now();
    const chatJid = this.canonical(raw, m.key.remoteJidAlt);
    const group = isJidGroup(raw) === true;
    // Em grupo, o autor vai no início do texto: "Nome: mensagem".
    const author = group && !m.key.fromMe ? this.authorName(m) : null;
    const ctx = extractContext(content);
    const body = ctx.mentions.length ? this.resolveMentions(extracted.text, ctx.mentions) : extracted.text;
    const incoming: IncomingMessage = {
      chatJid,
      id: m.key.id,
      rawJid: raw,
      participant: group ? (m.key.participant ?? null) : null,
      fromMe: !!m.key.fromMe,
      at,
      text: author ? `${author}: ${body}` : body,
      kind: extracted.kind,
      media: media ? JSON.stringify(media) : null,
      quoted: ctx.quoted ? JSON.stringify(this.quoteRef(chatJid, ctx.quoted, group)) : null,
      ack: m.key.fromMe ? (m.status ?? null) : null,
    };
    const isLive = live && Date.now() - at < LIVE_WINDOW_MS;
    // Enviada agora: guarda o proto para reenviar se o WhatsApp do contato pedir retry.
    if (isLive && m.key.fromMe && m.message) incoming.raw = proto.Message.encode(m.message).finish();
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

  /** Editar e reagir mudam uma mensagem já guardada. `quiet`: lote do histórico, sem evento. */
  private applyAction(chatJid: string, action: Action, m: WAMessage, quiet: boolean) {
    const at = Number(m.messageTimestamp ?? 0) * 1000 || Date.now();
    const message = action.type === "reaction"
      ? this.store.setReaction(chatJid, action.id, m.key.fromMe ? "me" : (m.key.participant ?? chatJid), action.emoji, at)
      : (this.store.editMessage(chatJid, action.id, action.text, at)?.message ?? null);
    if (message && !quiet) this.emit("update", { message, chat: this.store.getChat(chatJid)! });
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
    sock.ev.on("presence.update", ({ id, presences }) => {
      if (!isConversation(id)) return;
      const states = Object.values(presences).map((p) => p.lastKnownPresence);
      const state = states.includes("recording") ? "recording" : states.includes("composing") ? "composing" : null;
      this.emit("presence", { jid: this.canonical(id), state });
    });
    // Recibos das minhas mensagens: entregue, lida, ouvida.
    sock.ev.on("messages.update", (list) => {
      for (const { key, update } of list) {
        if (!key.fromMe || !key.id || typeof update.status !== "number" || !isConversation(key.remoteJid)) continue;
        const chatJid = this.canonical(key.remoteJid, key.remoteJidAlt);
        const message = this.store.setAck(chatJid, key.id, update.status);
        if (message) this.emit("update", { message, chat: this.store.getChat(chatJid)! });
      }
    });
  }

  private applyContact(c: { id?: string; lid?: string; phoneNumber?: string; name?: string; notify?: string; verifiedName?: string; imgUrl?: string | null }) {
    if (!c.id) return;
    if (c.lid && c.phoneNumber) this.learnLid(jidNormalizedUser(c.lid), jidNormalizedUser(c.phoneNumber));
    const raw = c.phoneNumber ?? c.id;
    if (!isConversation(raw) || isJidGroup(raw)) return;
    const jid = this.canonical(raw);
    // Foto trocada: a próxima consulta busca de novo.
    if ("imgUrl" in c) this.store.forgetPhoto(jid);
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

  private ready(): WASocket {
    if (!this.sock || this.state.status !== "conectado") throw new Error("O WhatsApp não está conectado.");
    return this.sock;
  }

  /** Mensagem mínima para a citação: chave + texto. */
  private quoted(ref: MessageKeyRef | null | undefined): { quoted: WAMessage } | undefined {
    if (!ref) return undefined;
    return {
      quoted: {
        key: { remoteJid: ref.rawJid, id: ref.id, fromMe: ref.fromMe, ...(ref.participant ? { participant: ref.participant } : {}) },
        message: { conversation: quoteText(ref) },
      },
    };
  }

  async send(jid: string, text: string, opts: SendOptions = {}): Promise<void> {
    const sock = this.ready();
    const all = opts.mentionAll && isJidGroup(jid);
    // "@todos": marca o grupo (nonJidMentions) e menciona cada participante, para todos serem
    // notificados também nos aparelhos que ainda não conhecem a menção ao grupo.
    const everyone = all ? (await this.groupInfo(jid)).participants.map((p) => p.id).filter((id) => !this.isMe(id)) : [];
    const list = [...new Set([...(opts.mentions ?? []), ...everyone])];
    const mentions = list.length || all ? { ...(list.length ? { mentions: list } : {}), ...(all ? { mentionAll: true } : {}) } : {};
    const sent = await sock.sendMessage(jid, { text, ...mentions }, this.quoted(opts.quoted));
    if (sent) this.ingest(sent, true);
  }

  /** Apaga para todos (só mensagens enviadas por mim). */
  async deleteForEveryone(ref: MessageKeyRef): Promise<void> {
    await this.ready().sendMessage(ref.rawJid, { delete: { remoteJid: ref.rawJid, id: ref.id, fromMe: true } });
  }

  /** Apaga para mim também no celular e nos outros aparelhos (sincronização do WhatsApp). */
  async deleteForMe(ref: MessageKeyRef): Promise<void> {
    await this.ready().chatModify(
      {
        deleteForMe: {
          deleteMedia: false,
          key: { remoteJid: ref.rawJid, id: ref.id, fromMe: ref.fromMe, ...(ref.participant ? { participant: ref.participant } : {}) },
          timestamp: Math.floor(ref.at / 1000),
        },
      },
      ref.rawJid,
    );
  }

  /** Chave de uma mensagem minha, depois de conferir o prazo do WhatsApp para editá-la. */
  private sentKey(jid: string, id: string) {
    const message = this.store.getMessage(jid, id);
    const key = this.store.messageKey(jid, id);
    if (!message || !key) throw new Error("Mensagem não encontrada.");
    const error = sentChangeError({ ...message, deletedAt: message.deleted ? 1 : null }, "edit");
    if (error) throw new Error(error);
    return { remoteJid: key.rawJid, id, fromMe: true };
  }

  async editSent(jid: string, id: string, text: string): Promise<void> {
    await this.ready().sendMessage(jid, { text, edit: this.sentKey(jid, id) });
    const result = this.store.editMessage(jid, id, text);
    if (result) this.emit("update", result);
  }

  /** Passa a receber "digitando" deste contato. Cortesia: falha não atrapalha. */
  async watchPresence(jid: string): Promise<void> {
    await this.sock?.presenceSubscribe(jid).catch(() => undefined);
  }

  async typing(jid: string, state: "composing" | "paused"): Promise<void> {
    await this.sock?.sendPresenceUpdate(state, jid).catch(() => undefined);
  }

  /** Emoji vazio tira a reação. */
  async react(jid: string, id: string, emoji: string): Promise<void> {
    const sock = this.ready();
    const key = this.store.messageKey(jid, id);
    if (!key) throw new Error("Mensagem não encontrada.");
    await sock.sendMessage(jid, {
      react: { text: emoji, key: { remoteJid: key.rawJid, id, fromMe: key.fromMe, ...(key.participant ? { participant: key.participant } : {}) } },
    });
    const message = this.store.setReaction(jid, id, "me", emoji);
    if (message) this.emit("update", { message, chat: this.store.getChat(jid)! });
  }

  /** Metadados do grupo (cache de 5 min: o "@" consulta a cada conversa aberta). */
  private groupCache = new Map<string, { at: number; data: Awaited<ReturnType<WASocket["groupMetadata"]>> }>();
  private async groupInfo(jid: string) {
    const hit = this.groupCache.get(jid);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
    const data = await this.ready().groupMetadata(jid);
    this.groupCache.set(jid, { at: Date.now(), data });
    this.setGroupName(jid, data.subject);
    return data;
  }

  async participants(jid: string): Promise<Participant[]> {
    if (!isJidGroup(jid)) return [];
    const meta = await this.groupInfo(jid);
    return meta.participants
      .map((p) => {
        const alt = p.phoneNumber ?? null;
        const canonical = this.canonical(p.id, alt);
        return {
          jid: p.id,
          name: this.nameOf(p.id, alt) ?? "Participante",
          phone: isPnUser(canonical) ? canonical.split("@")[0] : null,
          admin: !!p.admin,
          me: this.isMe(p.id),
        };
      })
      .sort((a, b) => Number(b.me) - Number(a.me) || Number(b.admin) - Number(a.admin) || a.name.localeCompare(b.name, "pt-BR"));
  }

  /** Recado do contato e, em grupo, descrição e participantes. O que for privado volta null. */
  async profile(jid: string): Promise<Profile> {
    const sock = this.ready();
    if (isJidGroup(jid)) {
      const meta = await this.groupInfo(jid);
      return {
        about: null,
        aboutAt: null,
        group: {
          subject: meta.subject,
          description: meta.desc?.trim() || null,
          createdAt: meta.creation ? meta.creation * 1000 : null,
          size: meta.size ?? meta.participants.length,
          participants: await this.participants(jid),
        },
      };
    }
    const list = await sock.fetchStatus(jid).catch(() => undefined);
    const status = (list?.[0] as { status?: { status?: string | null; setAt?: Date } } | undefined)?.status;
    const about = typeof status?.status === "string" && status.status.trim() ? status.status.trim() : null;
    const setAt = status?.setAt instanceof Date && status.setAt.getTime() > 0 ? status.setAt.getTime() : null;
    return { about, aboutAt: about ? setAt : null, group: null };
  }

  /** URL temporária da foto de perfil; null = sem foto ou foto privada. Erro de rede sobe. */
  async photoUrl(jid: string, full = false): Promise<string | null> {
    try {
      return (await this.ready().profilePictureUrl(jid, full ? "image" : "preview", 10_000)) ?? null;
    } catch (error) {
      const code = (error as { output?: { statusCode?: number } })?.output?.statusCode;
      // 404 = sem foto; 401/403 = privacidade.
      if (code === 404 || code === 401 || code === 403) return null;
      if (/item-not-found|not-authorized|forbidden/i.test(String((error as Error)?.message))) return null;
      throw error;
    }
  }

  /** Envia anexo; o tipo da mensagem (imagem, vídeo, voz, documento) sai do mimetype. Devolve o id enviado. */
  async sendMedia(jid: string, file: OutgoingFile, opts: SendOptions = {}): Promise<string | null> {
    const sock = this.ready();
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
    const sent = await sock.sendMessage(jid, content, this.quoted(opts.quoted));
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
