/** Conteúdo já normalizado (sem ephemeral/viewOnce) de uma mensagem do WhatsApp. */
type Content = Record<string, any> | null | undefined;

export type Extracted = { text: string; kind: string };

/** O suficiente para baixar e decifrar a mídia depois (WhatsApp guarda o arquivo cifrado). */
export type MediaRef = {
  type: "image" | "video" | "audio" | "document" | "sticker";
  mediaKey: string; // base64
  directPath: string | null;
  url: string | null;
  mimetype: string;
  fileName: string | null;
  size: number | null;
  /** Duração em segundos (áudio e vídeo), quando o WhatsApp informa. */
  seconds?: number | null;
  /** Áudio gravado no app (mensagem de voz), não arquivo de áudio. */
  ptt?: boolean;
};

const MEDIA_TYPES: Record<string, MediaRef["type"]> = {
  imageMessage: "image",
  videoMessage: "video",
  ptvMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
};

const DEFAULT_MIME: Record<MediaRef["type"], string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/ogg",
  document: "application/octet-stream",
  sticker: "image/webp",
};

export function extractMedia(content: Content): MediaRef | null {
  if (!content) return null;
  const key = Object.keys(content).find((k) => MEDIA_TYPES[k] && content[k]);
  if (!key) return null;
  const m = content[key];
  if (!m?.mediaKey || (!m.directPath && !m.url)) return null;
  const type = MEDIA_TYPES[key];
  return {
    type,
    mediaKey: Buffer.from(m.mediaKey).toString("base64"),
    directPath: m.directPath ?? null,
    url: m.url ?? null,
    mimetype: typeof m.mimetype === "string" && m.mimetype ? m.mimetype.split(";")[0] : DEFAULT_MIME[type],
    fileName: typeof m.fileName === "string" ? m.fileName : null,
    size: m.fileLength == null ? null : Number(m.fileLength),
    seconds: typeof m.seconds === "number" && m.seconds > 0 ? m.seconds : null,
    ptt: m.ptt === true,
  };
}

/** Tipos que não são mensagem para o usuário. Apagar sai por revokedId; editar e reagir por extractAction. */
const IGNORED = new Set([
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "pollUpdateMessage",
  "keepInChatMessage",
  "pinInChatMessage",
  "encReactionMessage",
  // Cabeçalho de álbum: as fotos chegam como mensagens próprias.
  "albumMessage",
  "editedMessage",
  "associatedChildMessage",
  "placeholderMessage",
  "messageHistoryBundle",
  "secretEncryptedMessage",
]);

/** Mensagem que muda outra: editar ou reagir (apagar para todos sai por revokedId). */
export type Action =
  | { type: "edit"; id: string; text: string }
  | { type: "reaction"; id: string; emoji: string };

/** Tipo de edição no protocolo do WhatsApp (proto.Message.ProtocolMessage.Type). */
const MESSAGE_EDIT = 14;

export function extractAction(content: Content): Action | null {
  if (!content) return null;
  const reaction = content.reactionMessage;
  if (reaction?.key?.id) return { type: "reaction", id: String(reaction.key.id), emoji: typeof reaction.text === "string" ? reaction.text : "" };
  const p = content.protocolMessage;
  if (!p?.key?.id) return null;
  if (p.type === MESSAGE_EDIT) {
    const edited = extractText(p.editedMessage);
    return edited ? { type: "edit", id: String(p.key.id), text: edited.text } : null;
  }
  return null;
}

/** Prazos do WhatsApp para mudar uma mensagem já enviada. */
export const EDIT_WINDOW_MS = 15 * 60_000;
export const REVOKE_WINDOW_MS = 60 * 3600_000;

/** Motivo de não poder editar ou apagar a mensagem; null = pode. */
export function sentChangeError(
  m: { fromMe: boolean; kind: string; at: number; deletedAt: number | null },
  change: "edit" | "revoke",
  now = Date.now(),
): string | null {
  if (!m.fromMe) return "Só dá para mudar mensagens enviadas por você.";
  if (m.deletedAt !== null) return "Esta mensagem já foi apagada.";
  if (change === "edit" && m.kind !== "text") return "Só mensagens de texto podem ser editadas.";
  if (change === "edit" && now - m.at > EDIT_WINDOW_MS) return "O WhatsApp só permite editar até 15 minutos depois do envio.";
  if (change === "revoke" && now - m.at > REVOKE_WINDOW_MS) return "O WhatsApp só permite apagar para todos até 60 horas depois do envio.";
  return null;
}

function withCaption(label: string, caption: unknown): string {
  const c = typeof caption === "string" ? caption.trim() : "";
  return c ? `${label} ${c}` : label;
}

/** Visualização única: o WhatsApp não entrega a mídia a aparelhos conectados; só o celular abre. */
export const VIEW_ONCE_KIND = "view_once";
const VIEW_ONCE_LABEL: Record<string, string> = { imageMessage: "Foto", videoMessage: "Vídeo", audioMessage: "Áudio" };

export function viewOnceText(what = "Mídia"): Extracted {
  return { text: `[${what} de visualização única] Abra no celular para ver.`, kind: VIEW_ONCE_KIND };
}

/** Converte a mensagem em texto exibível. Devolve null para o que não deve aparecer. */
export function extractText(content: Content): Extracted | null {
  if (!content) return null;
  const type = Object.keys(content).find((k) => !IGNORED.has(k) && content[k] != null);
  if (!type) return null;
  const m = content[type];
  if (m?.viewOnce === true && VIEW_ONCE_LABEL[type]) return viewOnceText(VIEW_ONCE_LABEL[type]);
  switch (type) {
    case "conversation":
      return typeof m === "string" && m.trim() ? { text: m, kind: "text" } : null;
    case "extendedTextMessage":
      return m.text?.trim() ? { text: m.text, kind: "text" } : null;
    case "imageMessage":
      return { text: withCaption("[Imagem]", m.caption), kind: "image" };
    case "videoMessage":
      return { text: withCaption(m.gifPlayback ? "[GIF]" : "[Vídeo]", m.caption), kind: "video" };
    case "audioMessage":
      return { text: m.ptt ? "[Áudio]" : "[Arquivo de áudio]", kind: "audio" };
    case "documentMessage":
      return { text: withCaption(`[Documento] ${m.fileName ?? ""}`.trim(), m.caption), kind: "document" };
    case "stickerMessage":
      return { text: "[Figurinha]", kind: "sticker" };
    case "locationMessage":
    case "liveLocationMessage":
      return { text: withCaption("[Localização]", m.name ?? m.address), kind: "location" };
    case "contactMessage":
      return { text: withCaption("[Contato]", m.displayName), kind: "contact" };
    case "contactsArrayMessage":
      return { text: withCaption("[Contatos]", m.displayName), kind: "contact" };
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
      return { text: withCaption("[Enquete]", m.name), kind: "poll" };
    case "buttonsResponseMessage":
      return { text: m.selectedDisplayText ?? "[Resposta]", kind: "text" };
    case "listResponseMessage":
      return { text: m.title ?? "[Resposta]", kind: "text" };
    case "templateButtonReplyMessage":
      return { text: m.selectedDisplayText ?? "[Resposta]", kind: "text" };
    case "ptvMessage":
      return { text: "[Vídeo]", kind: "video" };
    case "lottieStickerMessage":
      return { text: "[Figurinha]", kind: "sticker" };
    case "eventMessage":
      return { text: withCaption("[Evento]", m.name), kind: "other" };
    case "groupInviteMessage":
      return { text: withCaption("[Convite de grupo]", m.groupName), kind: "other" };
    case "interactiveMessage":
      return { text: m.body?.text?.trim() || "[Mensagem interativa]", kind: m.body?.text?.trim() ? "text" : "other" };
    case "templateMessage":
      return { text: m.hydratedTemplate?.hydratedContentText?.trim() || "[Mensagem de modelo]", kind: "other" };
    case "requestPhoneNumberMessage":
      return { text: "[Pedido de número de telefone]", kind: "other" };
    case "callLogMesssage": {
      const call = callFromLog(m);
      return { text: callText(call), kind: "call" };
    }
    default:
      // O tipo fica no `kind` para diagnóstico (ex.: other:fooMessage).
      return { text: "[Mensagem não suportada]", kind: `other:${type}` };
  }
}

/** Mensagem citada (resposta) e menções, tiradas do contextInfo da mensagem. */
export type MessageContext = {
  quoted: { id: string; participant: string | null; text: string } | null;
  mentions: string[];
};

export function extractContext(content: Content): MessageContext {
  const out: MessageContext = { quoted: null, mentions: [] };
  if (!content) return out;
  const type = Object.keys(content).find((k) => !IGNORED.has(k) && content[k] != null);
  const m = type ? content[type] : null;
  const info = m && typeof m === "object" ? m.contextInfo : null;
  if (!info) return out;
  if (Array.isArray(info.mentionedJid)) out.mentions = info.mentionedJid.filter((j: unknown): j is string => typeof j === "string");
  if (info.stanzaId && info.quotedMessage) {
    const quotedText = extractText(info.quotedMessage)?.text ?? "[Mensagem]";
    out.quoted = { id: String(info.stanzaId), participant: typeof info.participant === "string" ? info.participant : null, text: quotedText.slice(0, 500) };
  }
  return out;
}

/** Apagada para todos: devolve o id da mensagem revogada. */
export function revokedId(content: Content): string | null {
  const p = content?.protocolMessage;
  // type 0 = REVOKE no protocolo do WhatsApp.
  return p && (p.type === 0 || p.type === "REVOKE") && p.key?.id ? String(p.key.id) : null;
}

// ---- conteúdo rico: o que a tela precisa além do texto (enquete, localização, contato, evento, convite, ligação, prévia de link)

export type CallOutcome = "ringing" | "missed" | "rejected" | "connected" | "elsewhere" | "failed";
export type CallInfo = { video: boolean; outcome: CallOutcome; seconds: number | null; group: boolean; outgoing: boolean };

export type Extra =
  | { type: "poll"; question: string; options: string[]; selectable: number; secret: string | null }
  | { type: "location"; lat: number; lng: number; name: string | null; address: string | null; url: string | null; live: boolean }
  | { type: "event"; name: string; description: string | null; start: number | null; end: number | null; place: string | null; link: string | null; canceled: boolean }
  | { type: "invite"; groupJid: string; groupName: string | null; code: string; expiration: number | null; caption: string | null }
  | ({ type: "call" } & CallInfo);

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(typeof v === "object" && "toNumber" in v ? (v as { toNumber: () => number }).toNumber() : v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const b64 = (v: unknown): string | null => (v instanceof Uint8Array && v.length ? Buffer.from(v).toString("base64") : typeof v === "string" && v ? v : null);

/** proto.Message.CallLogMessage.CallOutcome; "silenciada" conta como perdida. */
const CALL_OUTCOMES: Record<number, CallOutcome> = { 0: "connected", 1: "missed", 2: "failed", 3: "rejected", 4: "elsewhere", 5: "ringing", 6: "missed", 7: "missed" };

function callFromLog(m: Record<string, any>): CallInfo {
  const seconds = num(m?.durationSecs);
  return {
    video: m?.isVideo === true,
    outcome: CALL_OUTCOMES[Number(m?.callOutcome ?? 1)] ?? "missed",
    seconds: seconds && seconds > 0 ? seconds : null,
    group: Array.isArray(m?.participants) && m.participants.length > 1,
    outgoing: false,
  };
}

const duration = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

/** Texto da ligação como aparece na conversa. */
export function callText(c: CallInfo): string {
  const what = `Chamada de ${c.video ? "vídeo" : "voz"}${c.group ? " em grupo" : ""}`;
  switch (c.outcome) {
    case "ringing":
      return `${what} recebida. Atenda no celular.`;
    case "missed":
      return c.outgoing ? `${what} não atendida` : `${what} perdida`;
    case "rejected":
      return `${what} recusada`;
    case "elsewhere":
      return `${what} atendida em outro aparelho`;
    case "failed":
      return `${what} não completada`;
    default:
      return c.seconds ? `${what} · ${duration(c.seconds)}` : what;
  }
}

/** Dados ricos da mensagem; null quando é só texto ou mídia. `secret` (enquete) vem do messageContextInfo. */
export function extractExtra(content: Content, secret?: unknown): Extra | null {
  if (!content) return null;
  const type = Object.keys(content).find((k) => !IGNORED.has(k) && content[k] != null);
  const m = type ? content[type] : null;
  if (!type || !m || typeof m !== "object") return null;
  switch (type) {
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3": {
      const options = (Array.isArray(m.options) ? m.options : []).map((o: { optionName?: unknown }) => String(o?.optionName ?? "")).filter(Boolean);
      return {
        type: "poll",
        question: str(m.name) ?? "Enquete",
        options,
        selectable: Number(m.selectableOptionsCount ?? 0) || 0,
        secret: b64(secret ?? content.messageContextInfo?.messageSecret),
      };
    }
    case "locationMessage":
    case "liveLocationMessage": {
      const lat = num(m.degreesLatitude);
      const lng = num(m.degreesLongitude);
      if (lat === null || lng === null) return null;
      return { type: "location", lat, lng, name: str(m.name), address: str(m.address), url: str(m.url), live: type === "liveLocationMessage" };
    }
    case "eventMessage": {
      const start = num(m.startTime);
      const end = num(m.endTime);
      return {
        type: "event",
        name: str(m.name) ?? "Evento",
        description: str(m.description),
        start: start ? start * 1000 : null,
        end: end ? end * 1000 : null,
        place: str(m.location?.name) ?? str(m.location?.address),
        link: str(m.joinLink),
        canceled: m.isCanceled === true,
      };
    }
    case "groupInviteMessage": {
      if (!str(m.groupJid) || !str(m.inviteCode)) return null;
      const exp = num(m.inviteExpiration);
      return { type: "invite", groupJid: String(m.groupJid), groupName: str(m.groupName), code: String(m.inviteCode), expiration: exp ? exp * 1000 : null, caption: str(m.caption) };
    }
    case "callLogMesssage":
      return { type: "call", ...callFromLog(m) };
    default:
      return null;
  }
}

/** Mudança de mensagens temporárias (protocolMessage EPHEMERAL_SETTING): segundos, 0 = desligou. */
export function ephemeralChange(content: Content): number | null {
  const p = content?.protocolMessage;
  if (!p || (p.type !== 3 && p.type !== "EPHEMERAL_SETTING")) return null;
  return num(p.ephemeralExpiration) ?? 0;
}

/** Fixar ou desafixar uma mensagem na conversa (pinInChatMessage). */
export type PinAction = { id: string; pin: boolean; seconds: number };
export function extractPin(content: Content): PinAction | null {
  const p = content?.pinInChatMessage;
  if (!p?.key?.id) return null;
  const pin = p.type === 1 || p.type === "PIN_FOR_ALL";
  return { id: String(p.key.id), pin, seconds: num(content?.messageContextInfo?.messageAddOnDurationInSecs) || 7 * 86400 };
}

/** Prazo das mensagens temporárias em palavras. */
export function ephemeralLabel(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    const days = seconds / 86400;
    return days === 1 ? "24 horas" : `${days} dias`;
  }
  return seconds >= 3600 ? `${Math.round(seconds / 3600)} horas` : `${Math.round(seconds / 60)} minutos`;
}
