/** Conteúdo já normalizado (sem ephemeral/viewOnce) de uma mensagem do WhatsApp. */
type Content = Record<string, any> | null | undefined;

export type Extracted = { text: string; kind: string };

/** Tipos que não são mensagem para o usuário: protocolo, reação, chaves, enquetes votadas. */
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
  // Edição chega como mensagem nova; o texto original já está salvo.
  "editedMessage",
  "associatedChildMessage",
  "placeholderMessage",
  "messageHistoryBundle",
  "secretEncryptedMessage",
]);

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
