// Mídia de uma mensagem como arquivo de verdade no disco, para copiar (área de transferência
// do Windows) ou abrir no app padrão sem passar pela pasta Downloads.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

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
export function mediaToTemp(origin: string, chatJid: string, id: string, tempDir: string): Promise<string> {
  // Mesma mídia pedida de novo (ou por dois caminhos ao mesmo tempo): um download só, e depois nenhum.
  const key = `${tempDir}|${chatJid}|${id}`;
  const known = saved.get(key);
  if (known) return known.then((path) => (existsSync(path) ? path : (saved.delete(key), mediaToTemp(origin, chatJid, id, tempDir))));
  const fresh = download(origin, chatJid, id, tempDir);
  saved.set(key, fresh);
  fresh.catch(() => saved.delete(key));
  return fresh;
}

const saved = new Map<string, Promise<string>>();

async function download(origin: string, chatJid: string, id: string, tempDir: string): Promise<string> {
  const url = `${origin}/api/media/${encodeURIComponent(chatJid)}/${encodeURIComponent(id)}?download=1`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Não foi possível baixar a mídia (HTTP ${res.status}).`);
  }
  const dir = join(tempDir, createHash("sha1").update(`${chatJid}|${id}`).digest("hex").slice(0, 16));
  const path = join(dir, safeFileName(fileNameFromDisposition(res.headers.get("content-disposition")) ?? "arquivo"));
  if (existsSync(path)) {
    void res.body?.cancel().catch(() => undefined);
    return path;
  }
  await mkdir(dir, { recursive: true });
  // Grava ao lado e renomeia: uma queda no meio não deixa um arquivo pela metade com o nome final.
  const part = `${path}.${process.pid}.part`;
  await writeFile(part, Buffer.from(await res.arrayBuffer()));
  await rename(part, path);
  return path;
}

/** Nomes sem repetição para colar vários arquivos na mesma pasta: "foto.jpg", "foto (2).jpg"… */
export function bundleNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Caminhos prontos para copiar juntos: quem repete o nome de outro ganha uma cópia renomeada na própria pasta. */
export async function bundlePaths(paths: string[]): Promise<string[]> {
  const unique = [...new Set(paths)];
  const names = bundleNames(unique.map((p) => basename(p)));
  return Promise.all(
    unique.map(async (path, i) => {
      if (names[i] === basename(path)) return path;
      const renamed = join(dirname(path), names[i]!);
      if (!existsSync(renamed)) await copyFile(path, renamed);
      return renamed;
    }),
  );
}
