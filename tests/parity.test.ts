import assert from "node:assert/strict";
import { test } from "node:test";
import { Store, type IncomingMessage } from "../server/db.ts";
import { EDIT_WINDOW_MS, extractAction, extractQuote, REVOKE_WINDOW_MS, sentChangeError } from "../server/text.ts";

const PN = "5511999990000@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
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

test("extractAction reconhece apagar, editar e reagir", () => {
  assert.deepEqual(extractAction({ protocolMessage: { type: 0, key: { id: "A" } } }), { type: "revoke", id: "A" });
  assert.deepEqual(
    extractAction({ protocolMessage: { type: 14, key: { id: "A" }, editedMessage: { conversation: "novo" } } }),
    { type: "edit", id: "A", text: "novo" },
  );
  assert.deepEqual(extractAction({ reactionMessage: { key: { id: "A" }, text: "👍" } }), { type: "reaction", id: "A", emoji: "👍" });
  assert.deepEqual(extractAction({ reactionMessage: { key: { id: "A" }, text: "" } }), { type: "reaction", id: "A", emoji: "" });
  // Outros protocolos (ex.: sincronização de chaves) continuam ignorados.
  assert.equal(extractAction({ protocolMessage: { type: 6, key: { id: "A" } } }), null);
  assert.equal(extractAction({ conversation: "oi" }), null);
});

test("extractQuote pega id e texto da mensagem citada", () => {
  const content = { extendedTextMessage: { text: "sim", contextInfo: { stanzaId: "Q1", quotedMessage: { imageMessage: { caption: "foto" } } } } };
  assert.deepEqual(extractQuote(content), { id: "Q1", text: "[Imagem] foto" });
  assert.equal(extractQuote({ conversation: "oi" }), null);
});

test("status de entrega só avança e só vale para as minhas", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "eu", fromMe: true, ack: 1 }), true);
  s.addMessage(msg({ id: "ele" }), true);
  assert.equal(s.setAck(PN, "eu", 4)?.ack, 4);
  assert.equal(s.setAck(PN, "eu", 3), null, "entregue depois de lida não volta");
  assert.equal(s.getMessage(PN, "eu")?.ack, 4);
  assert.equal(s.setAck(PN, "ele", 3), null);
  assert.equal(s.getMessage(PN, "ele")?.ack, null);
});

test("apagar para todos guarda o original e troca a prévia", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a", at: 1000, text: "segredo" }), true);
  const r = s.revokeMessage(PN, "a", 2000);
  assert.equal(r?.message.deletedAt, 2000);
  assert.equal(r?.message.text, "segredo");
  assert.equal(s.getChat(PN)?.lastText, "Mensagem apagada");
  assert.equal(s.revokeMessage(PN, "a"), null, "segunda vez não muda nada");
});

test("edição troca o texto, marca editada e mantém o autor no grupo", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a", at: 1000, text: "oi" }), true);
  s.addMessage(msg({ id: "b", at: 2000, text: "depois" }), true);
  const r = s.editMessage(PN, "a", "olá", 3000);
  assert.equal(r?.message.text, "olá");
  assert.equal(r?.message.editedAt, 3000);
  assert.equal(s.getChat(PN)?.lastText, "depois", "editar uma antiga não mexe na prévia");

  s.addMessage(msg({ chatJid: GROUP, rawJid: GROUP, participant: "55@s.whatsapp.net", id: "g", text: "Ana: oi" }), true);
  assert.equal(s.editMessage(GROUP, "g", "olá")?.message.text, "Ana: olá");
  assert.equal(s.messageText(GROUP, "g"), "olá");
});

test("reações: uma por pessoa, trocar e tirar", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a" }), true);
  s.setReaction(PN, "a", PN, "👍", 1);
  s.setReaction(PN, "a", "me", "❤️", 2);
  s.setReaction(PN, "a", PN, "😂", 3);
  assert.deepEqual(s.getMessage(PN, "a")?.reactions, [
    { emoji: "❤️", fromMe: true },
    { emoji: "😂", fromMe: false },
  ]);
  s.setReaction(PN, "a", "me", "");
  assert.deepEqual(s.listMessages(PN, null)[0].reactions, [{ emoji: "😂", fromMe: false }]);
});

test("citação é gravada e volta na mensagem", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a", text: "valor?" }), true);
  s.addMessage(msg({ id: "b", fromMe: true, text: "R$ 300", quoted: { id: "a", text: "valor?" } }), true);
  assert.deepEqual(s.getMessage(PN, "b")?.quoted, { id: "a", text: "valor?" });
  assert.deepEqual(s.messageKey(PN, "a"), { id: "a", rawJid: PN, participant: null, fromMe: false });
});

test("markRead devolve exatamente as não lidas, mesmo fora de ordem", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "nova", at: Date.now() }), true);
  // Histórico mais recente que a não lida não entra no recibo.
  s.addMessage(msg({ id: "hist", at: Date.now() + 1000 }), false);
  assert.deepEqual(s.markRead(PN).map((k) => k.id), ["nova"]);
  assert.deepEqual(s.markRead(PN), []);
});

test("mensagem enviada guarda o proto para retry", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "eu", fromMe: true, raw: new Uint8Array([1, 2, 3]) }), true);
  assert.deepEqual([...(s.rawMessage("eu") ?? [])], [1, 2, 3]);
  assert.equal(s.rawMessage("outra"), null);
});

test("prazos do WhatsApp para editar e apagar mensagem enviada", () => {
  const now = 10 * REVOKE_WINDOW_MS;
  const mine = { fromMe: true, kind: "text", at: now - 60_000, deletedAt: null };
  assert.equal(sentChangeError(mine, "edit", now), null);
  assert.equal(sentChangeError(mine, "revoke", now), null);
  assert.match(sentChangeError({ ...mine, fromMe: false }, "revoke", now) ?? "", /enviadas por você/);
  assert.match(sentChangeError({ ...mine, kind: "image" }, "edit", now) ?? "", /texto/);
  assert.equal(sentChangeError({ ...mine, kind: "image" }, "revoke", now), null, "mídia pode ser apagada");
  assert.match(sentChangeError({ ...mine, at: now - EDIT_WINDOW_MS - 1 }, "edit", now) ?? "", /15 minutos/);
  assert.equal(sentChangeError({ ...mine, at: now - EDIT_WINDOW_MS - 1 }, "revoke", now), null);
  assert.match(sentChangeError({ ...mine, at: now - REVOKE_WINDOW_MS - 1 }, "revoke", now) ?? "", /60 horas/);
  assert.match(sentChangeError({ ...mine, deletedAt: now }, "revoke", now) ?? "", /já foi apagada/);
});
