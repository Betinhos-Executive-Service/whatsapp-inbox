// Tipos e nomes de arquivo, sem dependências: usado pela API HTTP, pelo app desktop e pelo servidor MCP.
import { extname } from "node:path";

/** Documento sem tipo (octet-stream): deduz pela extensão os formatos que a visualização abre. */
export const TYPE_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};
/** Extensão pelo tipo, para foto, áudio e vídeo (o WhatsApp não manda nome de arquivo para eles). */
export const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "application/pdf": ".pdf",
};

/** Tipo de um arquivo local pela extensão (anexo proposto pelo MCP); inclui os que o WhatsApp mais recebe. */
export function typeByExtension(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  return TYPE_BY_EXT[ext] ?? EXTRA_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}
const EXTRA_TYPE_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".3gp": "video/3gpp",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".json": "application/json",
};

/** Nome vindo do content-disposition do servidor local (filename*=UTF-8''...). */
export function fileNameFromDisposition(header: string | null): string | null {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header ?? "");
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return null;
    }
  }
  return /filename="([^"]+)"/i.exec(header ?? "")?.[1] ?? null;
}
