import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store, type IncomingMessage } from "../server/db.ts";

const PN = "5511999990000@s.whatsapp.net";
const OTHER = "5521988887777@s.whatsapp.net";
const LID = "123456789@lid";
let seq = 0;
const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  chatJid: PN,
  id: `m${++seq}`,
  rawJid: PN,
  fromMe: false,
  at: 1000 + seq,
  text: "Olá",
  kind: "text",
  ...over,
});

test("busca acha sem acento, por começo de palavra, em todas as conversas, mais recentes primeiro", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a", at: 1, text: "Cotação para São Paulo amanhã" }), false);
  s.addMessage(msg({ chatJid: OTHER, rawJid: OTHER, id: "b", at: 2, text: "A cotacao saiu?" }), false);
  s.addMessage(msg({ id: "c", at: 3, text: "Nada a ver" }), false);
  const hits = s.search("cotação");
  assert.deepEqual(hits.map((h) => h.id), ["b", "a"]);
  assert.match(hits[1].snippet, /\u0002Cotação\u0003/);
  assert.deepEqual(s.search("sao pau").map((h) => h.id), ["a"], "duas palavras, a última pela metade");
  assert.deepEqual(s.search('"; drop'), [], "aspas e símbolos não quebram a busca");
  assert.deepEqual(s.search("   "), []);
});

test("busca acompanha edição, apagar e fusão de LID", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ chatJid: LID, rawJid: LID, id: "a", text: "placa ABC1234" }), false);
  s.editMessage(LID, "a", "placa XYZ9876");
  assert.equal(s.search("abc1234").length, 0);
  assert.equal(s.search("xyz9876")[0]?.chatJid, LID);
  s.mapLid(LID, PN);
  assert.equal(s.search("xyz9876")[0]?.chatJid, PN, "a mensagem muda de conversa no índice");
  s.markRevoked(PN, "a");
  assert.equal(s.search("xyz9876").length, 0, "apagada não aparece");
  s.addMessage(msg({ id: "b", text: "some daqui" }), false);
  s.deleteMessage(PN, "b");
  assert.equal(s.search("some").length, 0);
});

test("índice de busca é montado para mensagens que já existiam", () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-fts-"));
  try {
    const file = join(dir, "inbox.db");
    const first = new Store(file);
    first.addMessage(msg({ id: "a", text: "motorista confirmado" }), false);
    // Simula banco de uma versão sem o índice.
    first.db.exec("delete from messages_fts");
    first.db.close();
    const again = new Store(file);
    assert.equal(again.search("motorista")[0]?.id, "a");
    again.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("abrir no resultado: algumas antes e todas depois da mensagem achada", () => {
  const s = new Store(":memory:");
  for (let i = 0; i < 30; i++) s.addMessage(msg({ id: `x${i}`, at: i }), false);
  const list = s.listMessagesAround(PN, "x25", 5)!;
  assert.deepEqual(list.map((m) => m.id), ["x20", "x21", "x22", "x23", "x24", "x25", "x26", "x27", "x28", "x29"]);
  assert.equal(s.listMessagesAround(PN, "nao-existe"), null);
});

test("etiquetas extras: só cadastradas, sem repetir, somem quando a etiqueta sai", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  s.updateChat(PN, { label: "Cotação", extraLabels: ["Reserva", "Financeiro", "Reserva", "Inventada"] });
  assert.deepEqual(s.getChat(PN)?.extraLabels, ["Financeiro", "Reserva"]);
  assert.equal(s.getChat(PN)?.label, "Cotação");
  s.saveLabels(s.listLabels().filter((l) => l.name !== "Financeiro"));
  assert.deepEqual(s.getChat(PN)?.extraLabels, ["Reserva"]);
  s.updateChat(PN, { extraLabels: [] });
  assert.deepEqual(s.getChat(PN)?.extraLabels, []);
});

test("arquivada continua no arquivo com mensagem nova, como no WhatsApp", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  s.updateChat(PN, { archived: true });
  s.addMessage(msg(), true);
  const c = s.getChat(PN)!;
  assert.equal(c.archived, true);
  assert.equal(c.unread, 2, "conta como não lida mesmo arquivada");
  assert.equal(s.lastMessageKey(PN)?.id, s.listMessages(PN, null).at(-1)?.id);
});

test("fixar, arquivar e silenciar; sem 'manter arquivadas' a mensagem nova desarquiva", () => {
  const s = new Store(":memory:");
  s.keepArchived = false;
  s.addMessage(msg(), true);
  const c = s.updateChat(PN, { pinned: true, archived: true, mutedUntil: 5_000 })!;
  assert.ok(c.pinnedAt);
  assert.equal(c.archived, true);
  assert.equal(c.mutedUntil, 5_000);
  s.addMessage(msg({ fromMe: true }), true);
  assert.equal(s.getChat(PN)?.archived, true, "resposta minha não desarquiva");
  s.addMessage(msg(), true);
  assert.equal(s.getChat(PN)?.archived, false);
  assert.equal(s.getChat(PN)?.mutedUntil, 5_000, "silêncio continua");
  assert.equal(s.updateChat(PN, { pinned: false })?.pinnedAt, null);
});

test("adiar: volta como aberta na hora marcada ou quando o contato escreve", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  s.updateChat(PN, { status: "resolvida", snoozedUntil: 10_000 });
  assert.deepEqual(s.wakeSnoozed(9_999), []);
  const woke = s.wakeSnoozed(10_000);
  assert.equal(woke[0]?.status, "aberta");
  assert.equal(woke[0]?.snoozedUntil, null);
  s.updateChat(PN, { snoozedUntil: 50_000 });
  s.addMessage(msg(), true);
  assert.equal(s.getChat(PN)?.snoozedUntil, null);
});
