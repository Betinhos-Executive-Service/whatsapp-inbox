// Mídia de uma mensagem como arquivo de verdade no disco, para copiar (área de transferência
// do Windows) ou abrir no app padrão sem passar pela pasta Downloads.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Nome válido no Windows: sem caracteres reservados, nomes de dispositivo nem ponto/espaço no fim. */
export function safeFileName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 150);
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean)) return `arquivo${clean ? `_${clean}` : ""}`;
  return clean;
}

import { fileNameFromDisposition } from "../server/mime.ts";
export { fileNameFromDisposition };

/**
 * Baixa a mídia do servidor local para uma pasta temporária e devolve o caminho.
 * Cada mensagem tem a própria subpasta: nomes iguais em conversas diferentes não se sobrescrevem.
 */
export async function mediaToTemp(origin: string, chatJid: string, id: string, tempDir: string): Promise<string> {
  const url = `${origin}/api/media/${encodeURIComponent(chatJid)}/${encodeURIComponent(id)}?download=1`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Não foi possível baixar a mídia (HTTP ${res.status}).`);
  }
  const dir = join(tempDir, createHash("sha1").update(`${chatJid}|${id}`).digest("hex").slice(0, 16));
  const path = join(dir, safeFileName(fileNameFromDisposition(res.headers.get("content-disposition")) ?? "arquivo"));
  if (existsSync(path)) return path;
  await mkdir(dir, { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return path;
}
