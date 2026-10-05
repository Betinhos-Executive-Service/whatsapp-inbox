import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";

const PN = "5511999990000@s.whatsapp.net";
const LID = "123456789@lid";
const add = (s: Store, jid: string, at: number) =>
  s.addMessage({ chatJid: jid, id: `m${at}`, rawJid: jid, fromMe: false, at, text: "oi", kind: "text" }, false);

test("lembrete vencido avisa uma vez, reabre a conversa e some ao concluir", () => {
  const s = new Store(":memory:");
  add(s, PN, 1000);
  assert.equal(s.getChat(PN)?.status, "resolvida");
  const r = s.addReminder(PN, 5000, "Ligar para confirmar");
  assert.equal(s.getChat(PN)?.reminderAt, 5000);
  assert.deepEqual(s.fireDueReminders(4999), []);
  const fired = s.fireDueReminders(5000);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].chat.status, "aberta");
  assert.deepEqual(s.fireDueReminders(9000), []);
  assert.equal(s.finishReminder(r.id, "done"), PN);
  assert.equal(s.getChat(PN)?.reminderAt, null);
  assert.equal(s.finishReminder(999, "delete"), null);
});

test("nota e lembretes acompanham a fusão LID → número; limpar conversas apaga lembretes", () => {
  const s = new Store(":memory:");
  add(s, PN, 1000);
  add(s, LID, 2000);
  s.setNote(LID, "Cliente prefere áudio");
  s.addReminder(LID, 9000, "");
  s.mapLid(LID, PN);
  assert.equal(s.getChat(PN)?.note, "Cliente prefere áudio");
  assert.equal(s.listReminders(PN).length, 1);
  s.setNote(PN, "   ");
  assert.equal(s.getChat(PN)?.note, null);
  s.clearConversations();
  assert.equal(s.listReminders(PN).length, 0);
});

test("respostas rápidas mantêm a ordem e substituem a lista inteira", () => {
  const s = new Store(":memory:");
  s.saveQuickReplies([{ shortcut: "pix", text: "Chave Pix: ..." }, { shortcut: "endereco", text: "Rua ..." }]);
  assert.deepEqual(s.listQuickReplies().map((q) => q.shortcut), ["pix", "endereco"]);
  s.saveQuickReplies([{ shortcut: "ola", text: "Olá, {nome}!" }]);
  assert.deepEqual(s.listQuickReplies(), [{ shortcut: "ola", text: "Olá, {nome}!" }]);
});
