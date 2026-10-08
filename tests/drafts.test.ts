import assert from "node:assert/strict";
import { test } from "node:test";
import { Store, type IncomingMessage } from "../server/db.ts";

const PN = "5511999990000@s.whatsapp.net";
const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  chatJid: PN,
  id: `m${Math.random()}`,
  rawJid: PN,
  fromMe: false,
  at: Date.now(),
  text: "Olá",
  kind: "text",
  ...over,
});

test("rascunho pendente: grava, aparece resumido na conversa e some ao limpar", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "q1" }), true);
  assert.equal(s.getChat(PN)?.pendingDraft, null);

  const chat = s.setPendingDraft(PN, { text: "Bom dia! Confirmo o horário.", quotedId: "q1", source: "claude" });
  assert.equal(chat?.pendingDraft?.text, "Bom dia! Confirmo o horário.");
  assert.equal(chat?.pendingDraft?.hasMedia, false);
  assert.equal(chat?.pendingDraft?.source, "claude");
  assert.ok((chat?.pendingDraft?.createdAt ?? 0) > 0);

  const full = s.getPendingDraft(PN);
  assert.equal(full?.quotedId, "q1");
  assert.equal(full?.media, null);
  assert.equal(s.listChats()[0]?.pendingDraft?.text, "Bom dia! Confirmo o horário.");

  assert.equal(s.clearPendingDraft(PN), true);
  assert.equal(s.clearPendingDraft(PN), false);
  assert.equal(s.getChat(PN)?.pendingDraft, null);
  assert.equal(s.getPendingDraft(PN), null);
});

test("rascunho pendente com mídia: bytes voltam iguais e o resumo marca hasMedia", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  const body = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  s.setPendingDraft(PN, { text: "", media: { body, mimetype: "image/png", fileName: "foto.png" }, source: "claude" });
  const full = s.getPendingDraft(PN);
  assert.deepEqual(full?.media?.body, body);
  assert.equal(full?.media?.mimetype, "image/png");
  assert.equal(full?.media?.fileName, "foto.png");
  assert.equal(s.listChats()[0]?.pendingDraft?.hasMedia, true);
});

test("segundo rascunho substitui o primeiro; conversa inexistente não grava", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  s.setPendingDraft(PN, { text: "primeiro", source: "claude" });
  s.setPendingDraft(PN, { text: "segundo", source: "claude" });
  assert.equal(s.getPendingDraft(PN)?.text, "segundo");
  assert.equal(s.setPendingDraft("nao@s.whatsapp.net", { text: "x", source: "claude" }), null);
});

test("apagar as conversas leva o rascunho junto", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  s.setPendingDraft(PN, { text: "x", source: "claude" });
  s.clearConversations();
  assert.equal(s.getPendingDraft(PN), null);
});
