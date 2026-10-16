// Exportar conversa no formato do WhatsApp ("dd/mm/aaaa HH:mm - Nome: texto"), com ou sem a mídia anexada.
// Funções puras: o app lê as linhas do banco e a mídia do cache e só chama `renderExport`.

export type ExportRow = {
  id: string;
  at: number;
  fromMe: boolean;
  /** Autor em grupo (já sem o "Autor: " do texto); null fora de grupo ou nas minhas. */
  author: string | null;
  /** Texto sem o autor do grupo. */
  text: string;
  kind: string;
  media: { type: string; mimetype: string; fileName: string | null } | null;
  deleted: boolean;
};

export type ExportAttachment = { id: string; name: string };

const TZ = "America/Sao_Paulo";
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** `dd/mm/aaaa HH:mm` em America/Sao_Paulo. */
export function stampOf(ms: number): string {
  return `${dateFmt.format(ms)} ${timeFmt.format(ms)}`;
}

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "audio/ogg": ".opus",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "application/pdf": ".pdf",
};

function prefixOf(media: NonNullable<ExportRow["media"]>): string {
  if (media.type === "image") return "IMG";
  if (media.type === "video") return "VID";
  if (media.type === "sticker") return "STK";
  if (media.type === "audio") return media.mimetype.startsWith("audio/ogg") ? "PTT" : "AUD";
  return "DOC";
}

/** Nome válido num zip e no Windows. */
function cleanName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim().slice(0, 120) || "arquivo";
}

/**
 * Nomes dos anexos como o WhatsApp exporta: `IMG-aaaammdd-WA0001.jpg`, contando por dia e por tipo.
 * Documentos mantêm o nome original (com prefixo de ordem para não colidir).
 */
export function attachmentNames(rows: ExportRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const r of rows) {
    if (!r.media || r.deleted) continue;
    const prefix = prefixOf(r.media);
    const day = dayKeyFmt.format(r.at).replace(/-/g, "");
    const key = `${prefix}-${day}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    const seq = `WA${String(n).padStart(4, "0")}`;
    const base = r.media.mimetype.split(";")[0];
    const ext = EXT[base] ?? (r.media.fileName && /\.[a-z0-9]{1,5}$/i.test(r.media.fileName) ? r.media.fileName.slice(r.media.fileName.lastIndexOf(".")).toLowerCase() : "");
    const name = prefix === "DOC" && r.media.fileName ? `${key}-${seq}-${cleanName(r.media.fileName)}` : `${key}-${seq}${ext}`;
    out.set(r.id, name);
  }
  return out;
}

export type ExportOptions = {
  /** Nome do contato ou do grupo, usado como autor nas mensagens recebidas em conversa individual. */
  chatName: string;
  /** Com mídia: cada anexo vira "NOME (arquivo anexado)"; sem: "<Arquivo de mídia oculto>". */
  withMedia: boolean;
  /** Com mídia: diz se o arquivo da mensagem está disponível (expirado vira "<Arquivo de mídia indisponível>"). */
  available?: (id: string) => boolean;
};

/** Texto do export e a lista de anexos que entram no zip (só os disponíveis). */
export function renderExport(rows: ExportRow[], opts: ExportOptions): { text: string; attachments: ExportAttachment[] } {
  const names = opts.withMedia ? attachmentNames(rows) : new Map<string, string>();
  const attachments: ExportAttachment[] = [];
  const lines: string[] = [];
  for (const r of rows) {
    const stamp = stampOf(r.at);
    if (r.kind === "system" || r.kind === "call") {
      lines.push(`${stamp} - ${r.text}`);
      continue;
    }
    const who = r.fromMe ? "Você" : (r.author ?? opts.chatName);
    if (r.deleted) {
      lines.push(`${stamp} - ${who}: Mensagem apagada`);
      continue;
    }
    if (r.media) {
      const name = names.get(r.id);
      const ok = !!name && (opts.available?.(r.id) ?? true);
      const body = !opts.withMedia ? "<Arquivo de mídia oculto>" : ok ? `${name} (arquivo anexado)` : "<Arquivo de mídia indisponível>";
      if (ok && name) attachments.push({ id: r.id, name });
      // Legenda (ou nome do documento) na linha seguinte, como o WhatsApp.
      const caption = captionOf(r);
      lines.push(caption ? `${stamp} - ${who}: ${body}\n${caption}` : `${stamp} - ${who}: ${body}`);
      continue;
    }
    lines.push(`${stamp} - ${who}: ${r.text}`);
  }
  return { text: lines.join("\n") + (lines.length ? "\n" : ""), attachments };
}

/** Legenda da mídia: o texto sem o rótulo "[Imagem]" e sem o nome do arquivo. */
export function captionOf(r: ExportRow): string {
  if (!r.media) return r.text;
  let caption = r.text.replace(/^\[[^\]]+\]\s*/, "");
  if (r.media.fileName && caption.startsWith(r.media.fileName)) caption = caption.slice(r.media.fileName.length).trim();
  return caption.trim();
}

/** Nome do arquivo exportado, como o celular: "Conversa do WhatsApp com Fulano". */
export function exportFileName(chatName: string, withMedia: boolean): string {
  return `${cleanName(`Conversa do WhatsApp com ${chatName}`)}.${withMedia ? "zip" : "txt"}`;
}
