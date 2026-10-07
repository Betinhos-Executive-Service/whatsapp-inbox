import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaRef } from "./text.ts";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "image/gif": "gif",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

function mediaFile(dir: string, chatJid: string, id: string, mimetype: string): string {
  const name = createHash("sha256").update(`${chatJid}|${id}`).digest("hex").slice(0, 32);
  return join(dir, `${name}.${EXT[mimetype.split(";")[0]] ?? "bin"}`);
}

/** Guarda no disco a mídia que o próprio app enviou: abrir depois não baixa de novo. */
export async function cacheMedia(dir: string, chatJid: string, id: string, mimetype: string, body: Buffer): Promise<void> {
  const file = mediaFile(dir, chatJid, id, mimetype);
  mkdirSync(dir, { recursive: true });
  await writeFile(`${file}.part`, body);
  await rename(`${file}.part`, file);
}

/**
 * Baixa e decifra a mídia uma vez e guarda em data/media; as próximas aberturas vêm do disco.
 * Mídia muito antiga pode ter expirado no WhatsApp: aí o download falha com 404/410.
 */
type Loaded = { body: Buffer; mimetype: string; fileName: string | null };
const inflight = new Map<string, Promise<Loaded>>();

export function loadMedia(dir: string, chatJid: string, id: string, refJson: string): Promise<Loaded> {
  const key = `${dir}|${chatJid}|${id}`;
  let job = inflight.get(key);
  if (!job) {
    job = fetchMedia(dir, chatJid, id, refJson).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

async function fetchMedia(dir: string, chatJid: string, id: string, refJson: string): Promise<Loaded> {
  const ref = JSON.parse(refJson) as MediaRef;
  const file = mediaFile(dir, chatJid, id, ref.mimetype);
  try {
    return { body: await readFile(file), mimetype: ref.mimetype, fileName: ref.fileName };
  } catch {
    // ainda não está no disco
  }
  const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
  const stream = await downloadContentFromMessage(
    { mediaKey: Buffer.from(ref.mediaKey, "base64"), directPath: ref.directPath, url: ref.url },
    ref.type,
  );
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  mkdirSync(dir, { recursive: true });
  await writeFile(`${file}.part`, body);
  await rename(`${file}.part`, file);
  return { body, mimetype: ref.mimetype, fileName: ref.fileName };
}
