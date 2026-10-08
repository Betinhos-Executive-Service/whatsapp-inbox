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
  type WACallEvent,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import type { Chat, IncomingMessage, Message, MessageKeyRef, QuotedRef, Store } from "./db.ts";
import { buildVcard, extractContacts } from "./contacts.ts";
import { sendPreview } from "./link-preview.ts";
import { decryptVote, encryptVote, optionsFromHashes } from "./poll.ts";
import {
  callText,
  ephemeralChange,
  ephemeralLabel,
  extractAction,
  extractContext,
  extractExtra,
  extractMedia,
  extractPin,
  extractText,
  revokedId,
  sentChangeError,
  viewOnceText,
  type Action,
  type CallInfo,
  type Extra,
  type PinAction,
} from "./text.ts";

export type ConnectionStatus = "iniciando" | "qr" | "conectado" | "reconectando" | "desconectado";
export type ConnectionState = { status: ConnectionStatus; qr: string | null; me: string | null; error: string | null };

/** Mensagem com até 2 min de idade conta como "ao vivo": mexe em não lidas e status. */
const LIVE_WINDOW_MS = 2 * 60 * 1000;
/** A agenda é pedida de novo a cada 6 h: nomes salvos no celular depois chegam sozinhos. */
const CONTACTS_RESYNC_MS = 6 * 60 * 60 * 1000;
const logger = pino({ level: "silent" });

/** Conversas individuais e grupos; status, listas e canais ficam de fora. */
function isConversation(jid: string | null | undefined): jid is string {
  return !!jid && (isPnUser(jid) || isLidUser(jid) || isJidGroup(jid)) === true;
}

export type OutgoingFile = { body: Buffer; mimetype: string; fileName: string; caption?: string; ptt?: boolean; seconds?: number; sticker?: boolean };
/** Resposta a uma mensagem (citação) e menções com @. */
export type SendOptions = { quoted?: MessageKeyRef | null; mentions?: string[]; mentionAll?: boolean };

export type Participant = { jid: string; name: string; phone: string | null; admin: boolean; me: boolean };
export type Profile = {
  about: string | null;
  aboutAt: number | null;
  /** Contato bloqueado por este número. */
  blocked: boolean;
  group: {
    subject: string;
    description: string | null;
    createdAt: number | null;
    size: number;
    participants: Participant[];
    /** Sou admin: posso adicionar, remover e promover. */
    meAdmin: boolean;
    /** Só admins mudam nome e descrição. */
    restrict: boolean;
  } | null;
};

/** Ação em participantes do grupo e o resultado de cada um (o WhatsApp pode recusar alguns). */
export type ParticipantAction = "add" | "remove" | "promote" | "demote";
export type ParticipantResult = { jid: string; ok: boolean; reason: string | null };

const PARTICIPANT_ERRORS: Record<string, string> = {
  "401": "sem permissão de admin",
  "403": "a privacidade da pessoa não deixa adicionar; mande o link de convite",
  "404": "número sem WhatsApp",
  "408": "saiu do grupo há pouco; mande o link de convite",
  "409": "já está no grupo",
  "500": "o grupo está cheio",
};

/** Avisos de grupo (messageStubType) que aparecem na conversa. */
const STUB = { CREATE: 20, SUBJECT: 21, ICON: 22, DESCRIPTION: 24, RESTRICT: 25, ANNOUNCE: 26, ADD: 27, REMOVE: 28, PROMOTE: 29, DEMOTE: 30, INVITE: 31, LEAVE: 32, MISSED_VOICE: 40, MISSED_VIDEO: 41, MISSED_GROUP_VOICE: 45, MISSED_GROUP_VIDEO: 46, JOIN_REQUEST: 71, EPHEMERAL: 72 } as const;

const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "alguém") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);
const timestamp = (m: WAMessage) => Number(m.messageTimestamp ?? 0) * 1000 || Date.now();

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
  /** Arquivar/desarquivar feito aqui que ainda não chegou ao celular (ex.: faltava a chave). */
  private pendingArchive = new Map<string, boolean>();
  /** Contatos bloqueados (JID da conversa), lidos ao conectar e mantidos pelos eventos. */
  private blocked = new Set<string>();
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
    if (!isConversation(raw) || !m.key.id) return;
    const chatJid = this.canonical(raw, m.key.remoteJidAlt);
    if (!m.message && !viewOnce) {
      // Sem conteúdo: avisos do grupo (entrou, saiu, mudou o nome…) e ligação perdida.
      if (m.messageStubType) this.ingestStub(m, chatJid, live, quiet);
      return;
    }
    const content = normalizeMessageContent(m.message);
    const revoked = revokedId(content);
    if (revoked) {
      const message = this.store.markRevoked(chatJid, revoked);
      if (message && !quiet) this.emit("update", { message, chat: this.store.getChat(chatJid)! });
      return;
    }
    const action = extractAction(content);
    if (action) return this.applyAction(chatJid, action, m, quiet);
    const pin = extractPin({ ...content, messageContextInfo: content?.messageContextInfo ?? m.message?.messageContextInfo });
    if (pin) return this.applyPin(chatJid, pin, m, live, quiet);
    if (content?.pollUpdateMessage) return this.applyVote(chatJid, content.pollUpdateMessage, m, quiet);
    const ephemeral = ephemeralChange(content);
    if (ephemeral !== null) return this.applyEphemeral(chatJid, ephemeral, m, live, quiet);
    const extracted = viewOnce ? viewOnceText() : extractText(content);
    const media = viewOnce ? null : extractMedia(content);
    if (!extracted) return;
    const at = timestamp(m);
    const group = isJidGroup(raw) === true;
    let extra = viewOnce ? null : extractExtra(content, m.message?.messageContextInfo?.messageSecret);
    if (extra?.type === "call") {
      // Registro de ligação que o celular manda: o lado diz se foi feita ou recebida; o aviso ao vivo já pode ter entrado.
      if (this.store.hasCallNear(chatJid, at)) return;
      extra = { ...extra, outgoing: !!m.key.fromMe };
      extracted.text = callText(extra);
    }
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
      contacts: viewOnce ? null : (() => {
        const list = extractContacts(content);
        return list ? JSON.stringify(list) : null;
      })(),
      quoted: ctx.quoted ? JSON.stringify(this.quoteRef(chatJid, ctx.quoted, group)) : null,
      extra: extra ? JSON.stringify(extra) : null,
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

  /** Aviso na conversa (fixou, temporárias, entrou no grupo…): não conta como não lida. */
  private addNotice(chatJid: string, m: WAMessage, text: string, live: boolean, quiet: boolean, kind = "system", extra: Extra | null = null) {
    const at = timestamp(m);
    const incoming: IncomingMessage = {
      chatJid,
      id: m.key.id!,
      rawJid: m.key.remoteJid!,
      participant: isJidGroup(m.key.remoteJid!) ? (m.key.participant ?? null) : null,
      fromMe: !!m.key.fromMe,
      at,
      text,
      kind,
      extra: extra ? JSON.stringify(extra) : null,
      // Ligação perdida conta como mensagem nova; os demais avisos não.
      silent: kind !== "call",
    };
    const isLive = live && Date.now() - at < LIVE_WINDOW_MS;
    if (quiet) return void this.store.insertMessage(incoming, isLive);
    const result = this.store.addMessage(incoming, isLive);
    if (result) this.emit("message", { ...result, chat: this.store.getChat(chatJid)!, live: isLive && kind === "call" });
  }

  /** Quem fez a ação: "Você", o autor no grupo ou o contato. */
  private actorName(chatJid: string, m: WAMessage): string {
    if (m.key.fromMe) return "Você";
    if (isJidGroup(m.key.remoteJid!)) return m.key.participant ? (this.nameOf(m.key.participant, m.key.participantAlt) ?? m.pushName ?? "Alguém") : "Alguém";
    return this.store.getChat(chatJid)?.name ?? m.pushName ?? "O contato";
  }

  private applyPin(chatJid: string, pin: PinAction, m: WAMessage, live: boolean, quiet: boolean) {
    const at = timestamp(m);
    const chat = this.store.setPin(chatJid, pin.id, pin.pin ? at + pin.seconds * 1000 : null, at);
    if (pin.pin) this.addNotice(chatJid, m, `${this.actorName(chatJid, m)} fixou uma mensagem`, live, quiet);
    if (chat && !quiet) this.emit("chat", chat);
  }

  private applyEphemeral(chatJid: string, seconds: number, m: WAMessage, live: boolean, quiet: boolean) {
    const chat = this.store.setEphemeral(chatJid, seconds || null);
    const who = this.actorName(chatJid, m);
    const text = seconds
      ? `${who} ativou as mensagens temporárias. Novas mensagens somem em ${ephemeralLabel(seconds)}.`
      : `${who} desativou as mensagens temporárias.`;
    this.addNotice(chatJid, m, text, live, quiet);
    if (chat && !quiet) this.emit("chat", chat);
  }

  /** Formas do meu JID (número e LID): a enquete pode ter sido cifrada com qualquer uma. */
  private meJids(): string[] {
    const me = this.sock?.user;
    return [me?.id, me?.lid].filter((j): j is string => !!j).map((j) => jidNormalizedUser(j));
  }

  /** Um JID e o seu par (número ↔ LID), quando conhecido. */
  private withAlt(...jids: (string | null | undefined)[]): string[] {
    const out = new Set<string>();
    for (const raw of jids) {
      if (!raw) continue;
      const jid = jidNormalizedUser(raw);
      out.add(jid);
      const alt = isLidUser(jid) ? this.store.pnForLid(jid) : isPnUser(jid) ? this.store.lidForPn(jid) : null;
      if (alt) out.add(alt);
    }
    return [...out];
  }

  /** Voto que chegou (de alguém ou meu, pelo celular): decifra e soma na enquete. */
  private applyVote(chatJid: string, update: { pollCreationMessageKey?: { id?: string | null } | null; vote?: { encPayload?: Uint8Array | null; encIv?: Uint8Array | null } | null }, m: WAMessage, quiet: boolean) {
    const pollId = update.pollCreationMessageKey?.id;
    const enc = update.vote;
    if (!pollId || !enc?.encPayload || !enc.encIv) return;
    // O voto pode vir endereçado pelo LID e cair fora da conversa do número: acha a enquete pelo id.
    const pollChat = this.store.pollRef(chatJid, pollId) ? chatJid : this.store.pollChat(pollId);
    const ref = pollChat ? this.store.pollRef(pollChat, pollId) : null;
    if (!ref?.poll.secret) return void console.warn(`Voto de enquete ${pollId} sem a enquete salva (conversa ${chatJid}).`);
    const group = isJidGroup(m.key.remoteJid!) === true;
    const creators = ref.fromMe ? this.withAlt(...this.meJids()) : this.withAlt(ref.participant ?? ref.rawJid);
    const voters = m.key.fromMe ? this.withAlt(...this.meJids()) : group ? this.withAlt(m.key.participant, m.key.participantAlt) : this.withAlt(m.key.remoteJid, m.key.remoteJidAlt, pollChat);
    const hashes = decryptVote({ encPayload: enc.encPayload, encIv: enc.encIv }, { secret: Buffer.from(ref.poll.secret, "base64"), pollId, creators, voters });
    if (!hashes) return void console.warn(`Voto da enquete ${pollId} não decifrou.`);
    const voter = m.key.fromMe ? "me" : this.canonical(group ? m.key.participant! : m.key.remoteJid!, group ? m.key.participantAlt : m.key.remoteJidAlt);
    const message = this.store.recordVote(pollChat!, pollId, voter, optionsFromHashes(ref.poll.options, hashes), timestamp(m));
    if (message && !quiet) this.emit("update", { message, chat: this.store.getChat(pollChat!)! });
  }

  /** Participantes citados num aviso de grupo (JSON com id/LID e número, ou o JID puro). */
  private stubPeople(m: WAMessage): string[] {
    return (m.messageStubParameters ?? []).map((p: string) => {
      try {
        const o = JSON.parse(p) as { id?: string; lid?: string; phoneNumber?: string };
        const raw = o.id ?? o.lid ?? o.phoneNumber;
        return raw ? (this.nameOf(raw, o.phoneNumber) ?? "alguém") : "alguém";
      } catch {
        return /@/.test(p) ? (this.nameOf(p) ?? "alguém") : "alguém";
      }
    });
  }

  private ingestStub(m: WAMessage, chatJid: string, live: boolean, quiet: boolean) {
    const type = Number(m.messageStubType);
    const params: string[] = m.messageStubParameters ?? [];
    const who = this.actorName(chatJid, m);
    const people = () => this.stubPeople(m);
    const plural = () => people().length > 1;
    if (type === STUB.MISSED_VOICE || type === STUB.MISSED_VIDEO || type === STUB.MISSED_GROUP_VOICE || type === STUB.MISSED_GROUP_VIDEO) {
      if (this.store.hasCallNear(chatJid, timestamp(m))) return;
      const call: CallInfo = { video: type === STUB.MISSED_VIDEO || type === STUB.MISSED_GROUP_VIDEO, group: type >= STUB.MISSED_GROUP_VOICE, outcome: "missed", seconds: null, outgoing: false };
      return this.addNotice(chatJid, m, callText(call), live, quiet, "call", { type: "call", ...call });
    }
    if (type === STUB.EPHEMERAL) {
      const seconds = Number(params[0]) || 0;
      const chat = this.store.setEphemeral(chatJid, seconds || null);
      if (chat && !quiet) this.emit("chat", chat);
    }
    if (type >= STUB.ADD && type <= STUB.LEAVE) this.groupCache.delete(m.key.remoteJid!);
    const text = (() => {
      switch (type) {
        case STUB.CREATE:
          return `${who} criou o grupo${params[0] ? ` “${params[0]}”` : ""}`;
        case STUB.SUBJECT:
          return `${who} mudou o nome do grupo para “${params[0] ?? ""}”`;
        case STUB.ICON:
          return `${who} mudou a foto do grupo`;
        case STUB.DESCRIPTION:
          return `${who} mudou a descrição do grupo`;
        case STUB.RESTRICT:
          return params[0] === "on" || params[0] === "true" ? `${who} deixou só admins editarem os dados do grupo` : `${who} deixou todos editarem os dados do grupo`;
        case STUB.ANNOUNCE:
          return params[0] === "on" || params[0] === "true" ? `${who} deixou só admins enviarem mensagens` : `${who} deixou todos enviarem mensagens`;
        case STUB.ADD: {
          const names = people();
          return names.length === 1 && names[0] === who ? `${who} entrou no grupo` : `${who} adicionou ${joinNames(names)}`;
        }
        case STUB.REMOVE:
          return `${who} removeu ${joinNames(people())}`;
        case STUB.PROMOTE:
          return `${joinNames(people())} ${plural() ? "agora são admins" : "agora é admin"}`;
        case STUB.DEMOTE:
          return `${joinNames(people())} ${plural() ? "não são mais admins" : "não é mais admin"}`;
        case STUB.INVITE:
          return `${joinNames(people())} entrou usando o link de convite`;
        case STUB.LEAVE:
          return `${joinNames(people())} saiu`;
        case STUB.JOIN_REQUEST:
          return `${joinNames(people())} entrou no grupo`;
        case STUB.EPHEMERAL: {
          const seconds = Number(params[0]) || 0;
          return seconds ? `${who} ativou as mensagens temporárias. Novas mensagens somem em ${ephemeralLabel(seconds)}.` : `${who} desativou as mensagens temporárias.`;
        }
        default:
          return null;
      }
    })();
    if (text) this.addNotice(chatJid, m, text, live, quiet);
  }

  /** Ligações em andamento (o WhatsApp avisa oferta, atendimento e fim em eventos separados). */
  private calls = new Map<string, { chatJid: string; id: string; video: boolean; group: boolean; acceptedAt: number | null }>();

  /**
   * Ligação recebida: aparece na conversa na hora ("atenda no celular") e vira perdida, recusada ou
   * atendida quando termina. O aparelho conectado não atende: áudio e vídeo ficam no celular.
   */
  private onCall(c: WACallEvent) {
    const from = c.isGroup && c.groupJid ? c.groupJid : c.from || c.chatId;
    if (!isConversation(from)) return;
    const known = this.calls.get(c.id);
    const chatJid = known?.chatJid ?? this.canonical(from, c.callerPn);
    const id = `call-${c.id}`;
    const at = c.date instanceof Date && c.date.getTime() > 0 ? c.date.getTime() : Date.now();
    const info = (outcome: CallInfo["outcome"], seconds: number | null = null): CallInfo => ({
      video: known?.video ?? !!c.isVideo,
      group: known?.group ?? !!c.isGroup,
      outcome,
      seconds,
      outgoing: false,
    });
    const save = (call: CallInfo, missed: boolean) => {
      const extra = JSON.stringify({ type: "call", ...call });
      const updated = this.store.updateCall(chatJid, id, callText(call), extra, missed);
      if (updated) return this.emit("update", updated);
      const incoming: IncomingMessage = { chatJid, id, rawJid: from, fromMe: false, at, text: callText(call), kind: "call", extra, silent: !missed };
      const result = this.store.addMessage(incoming, !c.offline);
      if (result) this.emit("message", { ...result, live: !c.offline && missed });
    };
    switch (c.status) {
      case "offer": {
        this.calls.set(c.id, { chatJid, id, video: !!c.isVideo, group: !!c.isGroup, acceptedAt: null });
        if (c.offline) return;
        const call = info("ringing");
        const incoming: IncomingMessage = { chatJid, id, rawJid: from, fromMe: false, at, text: callText(call), kind: "call", extra: JSON.stringify({ type: "call", ...call }), silent: true };
        const result = this.store.addMessage(incoming, true);
        // Ao vivo: o app avisa como mensagem nova ("atenda no celular").
        if (result) this.emit("message", { ...result, live: true });
        return;
      }
      case "accept":
        if (known) known.acceptedAt = Date.now();
        return save(info("elsewhere"), false);
      case "reject":
        this.calls.delete(c.id);
        return save(info("rejected"), false);
      case "timeout":
        this.calls.delete(c.id);
        return save(info("missed"), true);
      case "terminate": {
        this.calls.delete(c.id);
        if (known?.acceptedAt) return save(info("connected", Math.round((Date.now() - known.acceptedAt) / 1000)), false);
        // Desligou antes de alguém atender: perdida (só se a oferta foi vista; senão não há o que dizer).
        if (known) return save(info("missed"), true);
        return;
      }
      default:
        return;
    }
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
    this.store.keepArchived = !state.creds.accountSettings?.unarchiveChats;
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
      if (update.accountSettings) this.store.keepArchived = !update.accountSettings.unarchiveChats;
      void saveCreds();
      // Chave nova do celular (pedida em syncArchives): agora dá para enviar e receber o arquivamento.
      if (update.myAppStateKeyId && this.state.status === "conectado") setTimeout(() => void this.syncArchives(sock), 3000);
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
        // Depois do histórico inicial; numa reconexão recente é só uma consulta à configuração.
        setTimeout(() => void this.backfillContacts(sock), 20000);
        setTimeout(() => void this.syncArchives(sock), 25000);
        // Enquanto esta conexão durar, confere a cada hora se a agenda já venceu.
        const timer = setInterval(() => (this.sock === sock ? void this.backfillContacts(sock) : clearInterval(timer)), 60 * 60 * 1000);
        void this.loadGroups(sock);
        sock
          .fetchBlocklist()
          .then((list) => (this.blocked = new Set(list.filter((j): j is string => !!j).map((j) => this.canonical(j)))))
          .catch(() => undefined);
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
          if (typeof c.archived === "boolean") this.store.updateChat(jid, { archived: c.archived });
          if (c.ephemeralExpiration != null) this.store.setEphemeral(jid, Number(c.ephemeralExpiration) || null);
          if (c.markedAsUnread) this.store.updateChat(jid, { markedUnread: true });
        }
        for (const contact of contacts) this.applyContact(contact);
        for (const m of messages) this.ingest(m, false, true);
      });
      this.emit("reload");
    });

    // Mudanças feitas no celular: arquivar (ou desarquivar por mensagem nova), marcar como lida/não lida, temporárias.
    sock.ev.on("chats.update", (list) => {
      for (const u of list) {
        if (!u.id || !isConversation(u.id)) continue;
        const jid = this.canonical(u.id);
        const current = this.store.getChat(jid);
        if (!current) continue;
        let changed = false;
        if (typeof u.archived === "boolean" && current.archived !== u.archived) {
          this.store.updateChat(jid, { archived: u.archived });
          changed = true;
        }
        // -1 = marcada como não lida; 0 = marcada como lida (só vem da sincronização, não de mensagem nova).
        if (u.unreadCount === -1 && !current.markedUnread) {
          this.store.updateChat(jid, { markedUnread: true });
          changed = true;
        } else if (u.unreadCount === 0 && (current.markedUnread || current.unread > 0)) {
          this.store.clearMarkedUnread(jid);
          this.store.markRead(jid);
          changed = true;
        }
        if (u.ephemeralExpiration !== undefined && (Number(u.ephemeralExpiration) || null) !== current.ephemeral) {
          this.store.setEphemeral(jid, Number(u.ephemeralExpiration) || null);
          changed = true;
        }
        const chat = changed ? this.store.getChat(jid) : null;
        if (chat && chat.lastAt > 0) this.emit("chat", chat);
      }
    });
    sock.ev.on("call", (list) => list.forEach((c) => this.onCall(c)));
    sock.ev.on("blocklist.set", ({ blocklist }) => {
      this.blocked = new Set(blocklist.map((j) => this.canonical(j)));
    });
    sock.ev.on("blocklist.update", ({ blocklist, type }) => {
      for (const j of blocklist) {
        if (type === "add") this.blocked.add(this.canonical(j));
        else this.blocked.delete(this.canonical(j));
      }
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
    // Recibos das minhas mensagens (entregue, lida, ouvida) e estrela dada no celular.
    sock.ev.on("messages.update", (list) => {
      for (const { key, update } of list) {
        if (!key.id || !isConversation(key.remoteJid)) continue;
        const chatJid = this.canonical(key.remoteJid, key.remoteJidAlt);
        let message: Message | null = null;
        if (key.fromMe && typeof update.status === "number") message = this.store.setAck(chatJid, key.id, update.status);
        if (typeof update.starred === "boolean") message = this.store.setStarred(chatJid, key.id, update.starred) ?? message;
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
   * A cada 6 h: pede de novo ao WhatsApp a agenda completa (coleção de contatos do app state).
   * Recupera nomes que chegaram antes de a conversa existir ou foram salvos no celular depois. Só leitura.
   */
  private async backfillContacts(sock: WASocket) {
    // Guarda a hora da última sincronização; o antigo "1" conta como vencido.
    const last = Number(this.store.getSetting("contacts_backfill") ?? 0);
    if (this.sock !== sock || Date.now() - last < CONTACTS_RESYNC_MS) return;
    try {
      await sock.authState.keys.set({ "app-state-sync-version": { critical_unblock_low: null } });
      await sock.resyncAppState(["critical_unblock_low"], true);
      this.store.setSetting("contacts_backfill", String(Date.now()));
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

  /** Citação e, com mensagens temporárias ligadas, o prazo (a mensagem some como as do celular). */
  private sendOptions(jid: string, quoted?: MessageKeyRef | null) {
    const ephemeral = this.store.getChat(jid)?.ephemeral;
    return { ...this.quoted(quoted), ...(ephemeral ? { ephemeralExpiration: ephemeral } : {}) };
  }

  async send(jid: string, text: string, opts: SendOptions = {}): Promise<void> {
    const sock = this.ready();
    const all = opts.mentionAll && isJidGroup(jid);
    // "@todos": marca o grupo (nonJidMentions) e menciona cada participante, para todos serem
    // notificados também nos aparelhos que ainda não conhecem a menção ao grupo.
    const everyone = all ? (await this.groupInfo(jid)).participants.map((p) => p.id).filter((id) => !this.isMe(id)) : [];
    const list = [...new Set([...(opts.mentions ?? []), ...everyone])];
    const mentions = list.length || all ? { ...(list.length ? { mentions: list } : {}), ...(all ? { mentionAll: true } : {}) } : {};
    // Prévia do primeiro link (título, descrição e miniatura), como o WhatsApp faz ao digitar.
    const preview = await sendPreview(text).catch(() => null);
    const sent = await sock.sendMessage(jid, { text, ...mentions, ...(preview ? { linkPreview: preview } : {}) }, this.sendOptions(jid, opts.quoted));
    if (sent) this.ingest(sent, true);
  }

  /** Enquete; `multiple` deixa marcar mais de uma opção. */
  async sendPoll(jid: string, question: string, options: string[], multiple: boolean): Promise<void> {
    const sent = await this.ready().sendMessage(jid, { poll: { name: question, values: options, selectableCount: multiple ? 0 : 1 } }, this.sendOptions(jid));
    if (sent) this.ingest(sent, true);
  }

  /** Meu voto (lista vazia tira o voto). Vai cifrado como o do celular e já conta aqui. */
  async votePoll(jid: string, pollId: string, options: string[]): Promise<Message | null> {
    const sock = this.ready();
    const ref = this.store.pollRef(jid, pollId);
    if (!ref) throw new Error("Enquete não encontrada.");
    if (!ref.poll.secret) throw new Error("Esta enquete chegou antes desta versão do app; vote pelo celular.");
    const valid = options.filter((o) => ref.poll.options.includes(o));
    if (ref.poll.selectable === 1 && valid.length > 1) throw new Error("Esta enquete aceita só uma opção.");
    // A cifra usa os JIDs como a conversa endereça: LID ou número.
    const group = isJidGroup(ref.rawJid) === true;
    const lidMode = group ? (await this.groupInfo(ref.rawJid)).addressingMode === "lid" : isLidUser(ref.rawJid) === true;
    const me = sock.user!;
    const myJid = jidNormalizedUser(lidMode && me.lid ? me.lid : me.id);
    const creator = ref.fromMe ? myJid : jidNormalizedUser(ref.participant ?? ref.rawJid);
    const vote = encryptVote(valid, { secret: Buffer.from(ref.poll.secret, "base64"), pollId, creator, voter: myJid });
    await sock.relayMessage(
      ref.rawJid,
      {
        pollUpdateMessage: {
          pollCreationMessageKey: { remoteJid: ref.rawJid, id: pollId, fromMe: ref.fromMe, ...(ref.participant ? { participant: ref.participant } : {}) },
          vote,
          senderTimestampMs: Date.now(),
        },
      },
      {},
    );
    const message = this.store.recordVote(jid, pollId, "me", valid);
    if (message) this.emit("update", { message, chat: this.store.getChat(jid)! });
    return message;
  }

  async sendLocation(jid: string, place: { lat: number; lng: number; name?: string; address?: string }): Promise<void> {
    const location = { degreesLatitude: place.lat, degreesLongitude: place.lng, ...(place.name ? { name: place.name } : {}), ...(place.address ? { address: place.address } : {}) };
    const sent = await this.ready().sendMessage(jid, { location }, this.sendOptions(jid));
    if (sent) this.ingest(sent, true);
  }

  async sendContacts(jid: string, contacts: { name: string; phone: string }[]): Promise<void> {
    const cards = contacts.map((c) => ({ displayName: c.name, vcard: buildVcard(c.name, c.phone) }));
    const displayName = cards.length === 1 ? cards[0].displayName : `${cards.length} contatos`;
    const sent = await this.ready().sendMessage(jid, { contacts: { displayName, contacts: cards } }, this.sendOptions(jid));
    if (sent) this.ingest(sent, true);
  }

  /** Chave de uma mensagem guardada, no formato do WhatsApp. */
  private keyOf(jid: string, id: string) {
    const ref = this.store.messageKey(jid, id);
    if (!ref) throw new Error("Mensagem não encontrada.");
    return { remoteJid: ref.rawJid, id, fromMe: ref.fromMe, ...(ref.participant ? { participant: ref.participant } : {}) };
  }

  /** Estrela: vai para o celular pela sincronização; sem a chave, fica só aqui. Devolve se sincronizou. */
  async star(jid: string, id: string, starred: boolean): Promise<boolean> {
    const key = this.keyOf(jid, id);
    let synced = true;
    try {
      await this.ready().chatModify({ star: { messages: [{ id, fromMe: key.fromMe }], star: starred } }, key.remoteJid);
    } catch (error) {
      synced = false;
      if ((error as { data?: { isMissingKey?: boolean } }).data?.isMissingKey && this.sock) await this.requestAppStateKey(this.sock).catch(() => undefined);
    }
    const message = this.store.setStarred(jid, id, starred);
    if (message) this.emit("update", { message, chat: this.store.getChat(jid)! });
    return synced;
  }

  /** Fixa para todos por `seconds` (24 h, 7 ou 30 dias) ou desafixa (null). */
  async pinMessage(jid: string, id: string, seconds: number | null): Promise<void> {
    const key = this.keyOf(jid, id);
    await this.ready().sendMessage(jid, seconds ? { pin: key, type: proto.PinInChat.Type.PIN_FOR_ALL, time: seconds as 86400 } : { pin: key, type: proto.PinInChat.Type.UNPIN_FOR_ALL });
    const chat = this.store.setPin(jid, id, seconds ? Date.now() + seconds * 1000 : null);
    if (chat) this.emit("chat", chat);
  }

  /** Últimas mensagens da conversa: o WhatsApp exige ao arquivar ou marcar como lida/não lida. */
  private lastMessages(jid: string) {
    const last = this.store.lastMessageKey(jid);
    if (!last) return null;
    const key = { remoteJid: last.rawJid, id: last.id, fromMe: last.fromMe, ...(last.participant ? { participant: last.participant } : {}) };
    return { rawJid: last.rawJid, lastMessages: [{ key, messageTimestamp: Math.floor(last.at / 1000) }] };
  }

  /** Marca como lida/não lida também no celular. Cortesia: sem a chave, vale só aqui. */
  async syncUnread(jid: string, unread: boolean): Promise<void> {
    const last = this.lastMessages(jid);
    if (!this.sock || !last) return;
    try {
      await this.sock.chatModify({ markRead: !unread, lastMessages: last.lastMessages }, last.rawJid);
    } catch (error) {
      if ((error as { data?: { isMissingKey?: boolean } }).data?.isMissingKey) await this.requestAppStateKey(this.sock).catch(() => undefined);
      throw error;
    }
  }

  isBlocked(jid: string): boolean {
    return this.blocked.has(jid);
  }

  async setBlocked(jid: string, blocked: boolean): Promise<void> {
    if (isJidGroup(jid)) throw new Error("Grupos não podem ser bloqueados.");
    await this.ready().updateBlockStatus(jid, blocked ? "block" : "unblock");
    if (blocked) this.blocked.add(jid);
    else this.blocked.delete(jid);
  }

  /** Liga (segundos) ou desliga (0) as mensagens temporárias para todos da conversa. */
  async setEphemeral(jid: string, seconds: number): Promise<void> {
    const sock = this.ready();
    if (isJidGroup(jid)) await sock.groupToggleEphemeral(jid, seconds);
    else {
      const sent = await sock.sendMessage(jid, { disappearingMessagesInChat: seconds || false });
      if (sent) this.ingest(sent, true);
    }
    const chat = this.store.setEphemeral(jid, seconds || null);
    if (chat) this.emit("chat", chat);
  }

  /** Número tem WhatsApp? Devolve o JID da conversa ou null. */
  async checkNumber(digits: string): Promise<string | null> {
    const [hit] = (await this.ready().onWhatsApp(`${digits}@s.whatsapp.net`)) ?? [];
    return hit?.exists ? jidNormalizedUser(hit.jid) : null;
  }

  /** Conversa de um participante (pode vir como LID): o número quando conhecido. */
  conversationOf(jid: string): string {
    return this.canonical(jid);
  }

  async createGroup(subject: string, participants: string[]): Promise<string> {
    const meta = await this.ready().groupCreate(subject, participants);
    this.store.ensureChat(meta.id, { status: "aberta" });
    this.store.setNames(meta.id, { saved: meta.subject || subject });
    return meta.id;
  }

  async updateParticipants(jid: string, participants: string[], action: ParticipantAction): Promise<ParticipantResult[]> {
    const results = await this.ready().groupParticipantsUpdate(jid, participants, action);
    this.groupCache.delete(jid);
    return results.map((r) => ({
      jid: r.jid ?? "",
      ok: r.status === "200",
      reason: r.status === "200" ? null : (PARTICIPANT_ERRORS[r.status] ?? `recusado pelo WhatsApp (${r.status})`),
    }));
  }

  async updateGroupInfo(jid: string, info: { subject?: string; description?: string }): Promise<void> {
    const sock = this.ready();
    if (info.subject !== undefined) {
      await sock.groupUpdateSubject(jid, info.subject);
      this.setGroupName(jid, info.subject);
    }
    if (info.description !== undefined) await sock.groupUpdateDescription(jid, info.description || undefined);
    this.groupCache.delete(jid);
  }

  /** Aceita o convite de grupo recebido numa mensagem. Devolve o JID do grupo. */
  async acceptInvite(jid: string, id: string): Promise<string> {
    const extra = this.store.messageExtra(jid, id);
    if (extra?.type !== "invite") throw new Error("Esta mensagem não é um convite de grupo.");
    if (extra.expiration && extra.expiration < Date.now()) throw new Error("O convite venceu. Peça um novo a quem enviou.");
    const key = this.keyOf(jid, id);
    await this.ready().groupAcceptInviteV4(key, {
      groupJid: extra.groupJid,
      inviteCode: extra.code,
      inviteExpiration: Math.floor((extra.expiration ?? Date.now() + 86400_000) / 1000),
      groupName: extra.groupName ?? undefined,
    });
    this.store.ensureChat(extra.groupJid, { status: "aberta" });
    if (extra.groupName) this.store.setNames(extra.groupJid, { saved: extra.groupName });
    return extra.groupJid;
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
      const participants = await this.participants(jid);
      return {
        about: null,
        aboutAt: null,
        blocked: false,
        group: {
          subject: meta.subject,
          description: meta.desc?.trim() || null,
          createdAt: meta.creation ? meta.creation * 1000 : null,
          size: meta.size ?? meta.participants.length,
          participants,
          meAdmin: participants.some((p) => p.me && p.admin),
          restrict: !!meta.restrict,
        },
      };
    }
    const list = await sock.fetchStatus(jid).catch(() => undefined);
    const status = (list?.[0] as { status?: { status?: string | null; setAt?: Date } } | undefined)?.status;
    const about = typeof status?.status === "string" && status.status.trim() ? status.status.trim() : null;
    const setAt = status?.setAt instanceof Date && status.setAt.getTime() > 0 ? status.setAt.getTime() : null;
    return { about, aboutAt: about ? setAt : null, blocked: this.blocked.has(this.canonical(jid)), group: null };
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
    const content = file.sticker
      ? { sticker: body, mimetype: "image/webp" }
      : file.ptt
      ? { audio: body, ptt: true, mimetype: "audio/ogg; codecs=opus", ...(file.seconds ? { seconds: Math.round(file.seconds) } : {}) }
      : base.startsWith("image/") && base !== "image/gif" && base !== "image/svg+xml"
        ? { image: body, mimetype: base, caption }
        : base === "video/mp4"
          ? { video: body, mimetype: base, caption }
          : base.startsWith("audio/")
            ? { audio: body, mimetype: base }
            : { document: body, mimetype: base || "application/octet-stream", fileName, caption };
    const sent = await sock.sendMessage(jid, content, this.sendOptions(jid, opts.quoted));
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

  /** Arquiva ou desarquiva também no celular. Sem conexão ou sem a chave, fica pendente. */
  async setArchived(jid: string, archived: boolean): Promise<void> {
    this.pendingArchive.set(jid, archived);
    if (this.sock) await this.pushArchives(this.sock);
  }

  /** O WhatsApp pede a última mensagem da conversa junto com o arquivar. */
  private async pushArchives(sock: WASocket): Promise<void> {
    for (const [jid, archived] of [...this.pendingArchive]) {
      const last = this.store.lastMessageKey(jid);
      if (last) {
        const key = { remoteJid: last.rawJid, id: last.id, fromMe: last.fromMe, ...(last.participant ? { participant: last.participant } : {}) };
        try {
          await sock.chatModify({ archive: archived, lastMessages: [{ key, messageTimestamp: Math.floor(last.at / 1000) }] }, last.rawJid);
        } catch (error) {
          if ((error as { data?: { isMissingKey?: boolean } }).data?.isMissingKey) await this.requestAppStateKey(sock);
          throw error;
        }
      }
      if (this.pendingArchive.get(jid) === archived) this.pendingArchive.delete(jid);
    }
  }

  /**
   * Arquivar e fixar viajam no "estado do app", cifrado com uma chave que o celular troca de tempos
   * em tempos. Sem a chave atual, nada vai nem vem: pede ao celular. Com ela, envia o que ficou
   * pendente e relê o arquivamento inteiro do celular (o histórico inicial não traz isso direito).
   */
  private async syncArchives(sock: WASocket): Promise<void> {
    if (this.sock !== sock) return;
    try {
      if (!(await this.hasAppStateKey(sock))) return void (await this.requestAppStateKey(sock));
      await this.pushArchives(sock);
      await sock.authState.keys.set({ "app-state-sync-version": { regular_low: null } });
      await sock.resyncAppState(["regular_low"], false);
    } catch (error) {
      console.warn(`Sincronizar arquivadas com o celular falhou: ${(error as Error).message}`);
    }
  }

  private async hasAppStateKey(sock: WASocket): Promise<boolean> {
    const id = sock.authState.creds.myAppStateKeyId;
    if (!id) return false;
    const found = await sock.authState.keys.get("app-state-sync-key", [id]);
    return !!found[id];
  }

  /** Pede ao celular a chave do estado do app; ela volta numa mensagem que o Baileys guarda sozinho. */
  private async requestAppStateKey(sock: WASocket): Promise<void> {
    const id = sock.authState.creds.myAppStateKeyId;
    const me = sock.authState.creds.me?.id;
    if (!id || !me) return;
    console.warn(`Chave de sincronização ${id} ausente; pedindo ao celular.`);
    await sock.relayMessage(
      jidNormalizedUser(me),
      {
        protocolMessage: {
          type: proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_REQUEST,
          appStateSyncKeyRequest: { keyIds: [{ keyId: Buffer.from(id, "base64") }] },
        },
      },
      { additionalAttributes: { category: "peer", push_priority: "high_force" }, additionalNodes: [{ tag: "meta", attrs: { appdata: "default" } }] },
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
