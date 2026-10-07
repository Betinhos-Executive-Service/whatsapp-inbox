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
  "callLogMesssage",
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

/** Converte a mensagem em texto exibível. Devolve null para o que não deve aparecer. */
export function extractText(content: Content): Extracted | null {
  if (!content) return null;
  const type = Object.keys(content).find((k) => !IGNORED.has(k) && content[k] != null);
  if (!type) return null;
  const m = content[type];
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
      return { text: "[Contatos]", kind: "contact" };
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
