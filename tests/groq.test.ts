import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cachedTranscript, saveTranscript, transcribeAudio } from "../server/groq.ts";

test("transcribeAudio envia multipart em pt com Whisper Turbo", async () => {
  let sent: FormData | null = null;
  const fake = (async (_url: string, init: RequestInit) => {
    sent = init.body as FormData;
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer gsk_test");
    return new Response(JSON.stringify({ text: " Olá, tudo bem? " }), { status: 200 });
  }) as typeof fetch;
  const text = await transcribeAudio(fake, "gsk_test", Buffer.from("ogg"), "audio/ogg; codecs=opus");
  assert.equal(text, "Olá, tudo bem?");
  assert.equal(sent!.get("model"), "whisper-large-v3-turbo");
  assert.equal(sent!.get("language"), "pt");
  assert.equal((sent!.get("file") as File).name, "audio.ogg");
});

test("transcribeAudio traduz 401 em mensagem clara", async () => {
  const fake = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  await assert.rejects(transcribeAudio(fake, "x", Buffer.from("a"), "audio/ogg"), /Chave da Groq inválida/);
});

test("cache de transcrição", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "groq-")), "t");
  assert.equal(await cachedTranscript(dir, "j", "1"), null);
  await saveTranscript(dir, "j", "1", "texto");
  assert.equal(await cachedTranscript(dir, "j", "1"), "texto");
});

test("escolha por conversa de transcrição automática persiste", async () => {
  const { Store } = await import("../server/db.ts");
  const store = new Store(":memory:");
  const jid = "5511999999999@s.whatsapp.net";
  store.ensureChat(jid);
  assert.equal(store.getChat(jid)?.autoTranscribe, null);
  assert.equal(store.updateChat(jid, { autoTranscribe: "on" })?.autoTranscribe, "on");
  assert.equal(store.updateChat(jid, { autoTranscribe: null })?.autoTranscribe, null);
});
