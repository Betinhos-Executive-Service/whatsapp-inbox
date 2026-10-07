import assert from "node:assert/strict";
import { test } from "node:test";
import { isUrgent, notificationBody, notificationTitle, UnreadCounter } from "../desktop/notifications.ts";

const msg = (text: string, media: { seconds: number | null } | null = null) => ({
  text,
  media: media ? { type: "audio", mimetype: "audio/ogg", fileName: null, size: null, seconds: media.seconds, ptt: true } : null,
});

test("corpo: texto simples, corte em 180 e preview desligado", () => {
  assert.equal(notificationBody(msg("Bom dia"), true), "Bom dia");
  assert.equal(notificationBody(msg("x".repeat(200)), true), `${"x".repeat(179)}…`);
  assert.equal(notificationBody(msg("segredo"), false), "Nova mensagem");
});

test("corpo: mídia vira rótulo amigável e preserva autor e legenda", () => {
  assert.equal(notificationBody(msg("[Imagem] olha isso"), true), "📷 Foto olha isso");
  assert.equal(notificationBody(msg("Ana: [Imagem]"), true), "Ana: 📷 Foto");
  assert.equal(notificationBody(msg("[Áudio]", { seconds: 72 }), true), "🎤 Áudio 1:12");
  assert.equal(notificationBody(msg("[Áudio]", { seconds: null }), true), "🎤 Áudio");
  assert.equal(notificationBody(msg("[Documento] nota.pdf"), true), "📄 nota.pdf");
  assert.equal(notificationBody(msg("[Documento]"), true), "📄 Documento");
  assert.equal(notificationBody(msg("[Arquivo de áudio]"), true), "🎵 Áudio");
  assert.equal(notificationBody(msg("[Vídeo]"), true), "🎥 Vídeo");
  assert.equal(notificationBody(msg("[GIF]"), true), "🎞️ GIF");
  assert.equal(notificationBody(msg("[Localização] Av. Paulista"), true), "📍 Localização Av. Paulista");
  assert.equal(notificationBody(msg("[Contatos]"), true), "👤 Contato");
  assert.equal(notificationBody(msg("[Enquete] Horário?"), true), "📊 Enquete Horário?");
  assert.equal(notificationBody(msg("[Figurinha]"), true), "Figurinha");
});

test("título: contador e urgência", () => {
  const ai = (priority: "alta" | "media" | "baixa" | null) =>
    ({ label: "Reserva", confidence: 1, needsReply: 1, urgent: 0, priority, reason: null, at: 0 });
  assert.equal(notificationTitle({ name: "Ana", ai: null }, 1), "Ana");
  assert.equal(notificationTitle({ name: "Ana", ai: null }, 3), "Ana · 3 novas");
  assert.equal(notificationTitle({ name: "Ana", ai: ai("alta") }, 2), "Urgente · Ana · 2 novas");
  assert.equal(isUrgent({ ai: ai("alta") }), true);
  assert.equal(isUrgent({ ai: ai("media") }), false);
  assert.equal(isUrgent({ ai: null }), false);
});

test("contador por conversa", () => {
  const c = new UnreadCounter();
  assert.equal(c.bump("a"), 1);
  assert.equal(c.bump("a"), 2);
  assert.equal(c.bump("b"), 1);
  c.clear("a");
  assert.equal(c.get("a"), 0);
  assert.equal(c.bump("a"), 1);
});
