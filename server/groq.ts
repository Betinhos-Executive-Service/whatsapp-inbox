// Transcrição de áudio pela Groq (Whisper Large v3 Turbo). Só o arquivo de áudio vai para a API;
// o texto fica em cache em data/transcripts para não pagar duas vezes pelo mesmo áudio.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
/** Limite de upload da Groq no plano gratuito/dev. */
const MAX_BYTES = 25 * 1024 * 1024;

type Fetch = typeof fetch;

export async function transcribeAudio(fetcher: Fetch, key: string, body: Buffer, mimetype: string): Promise<string> {
  if (body.length > MAX_BYTES) throw new Error("Áudio grande demais para transcrever (limite de 25 MB).");
  const base = mimetype.split(";")[0].trim() || "audio/ogg";
  const ext = base === "audio/mpeg" ? "mp3" : base === "audio/mp4" ? "m4a" : base === "audio/webm" ? "webm" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(body)], { type: base }), `audio.${ext}`);
  form.append("model", GROQ_TRANSCRIBE_MODEL);
  form.append("language", "pt");
  form.append("response_format", "json");
  form.append("temperature", "0");
  const res = await fetcher(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  const data = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
  if (!res.ok) {
    if (res.status === 401) throw new Error("Chave da Groq inválida. Confira em Configurações › IA.");
    if (res.status === 429) throw new Error("Limite da Groq atingido. Tente de novo em instantes.");
    throw new Error(`A Groq não transcreveu o áudio (${res.status}${data?.error?.message ? `: ${data.error.message}` : ""}).`);
  }
  return (data?.text ?? "").trim();
}

const cacheFile = (dir: string, chatJid: string, id: string) =>
  join(dir, `${createHash("sha256").update(`${chatJid}|${id}`).digest("hex").slice(0, 32)}.txt`);

export async function cachedTranscript(dir: string, chatJid: string, id: string): Promise<string | null> {
  return readFile(cacheFile(dir, chatJid, id), "utf8").catch(() => null);
}

export async function saveTranscript(dir: string, chatJid: string, id: string, text: string): Promise<void> {
  const file = cacheFile(dir, chatJid, id);
  mkdirSync(dir, { recursive: true });
  await writeFile(`${file}.part`, text, "utf8");
  await rename(`${file}.part`, file);
}
