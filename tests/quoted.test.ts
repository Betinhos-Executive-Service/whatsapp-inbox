import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageKeyRef } from "../server/db.ts";
import { quotedOption } from "../server/whatsapp.ts";

const PN = "5511999990000@s.whatsapp.net";
const LID = "111111111111111@lid";
const GROUP = "120363000000000000@g.us";
const ME_LID = "222222222222222@lid";
const ref = (r: Partial<MessageKeyRef>): MessageKeyRef => ({ chatJid: PN, id: "Q1", rawJid: LID, fromMe: false, participant: null, text: "oi", at: 1, ...r });

test("citação na mesma conversa usa o jid de destino, não o LID guardado", () => {
  const q = quotedOption(PN, ref({}))!.quoted;
  assert.equal(q.key.remoteJid, PN);
  assert.equal(q.key.fromMe, false);
  assert.equal(q.message?.conversation, "oi");
});

test("citação de outra conversa mantém o jid de origem", () => {
  const q = quotedOption(GROUP, ref({}))!.quoted;
  assert.equal(q.key.remoteJid, LID);
});

test("sua mensagem citada em grupo com LID vai com o seu LID como autor", () => {
  const q = quotedOption(GROUP, ref({ chatJid: GROUP, rawJid: GROUP, fromMe: true, participant: ME_LID }))!.quoted;
  assert.equal(q.key.remoteJid, GROUP);
  assert.equal(q.key.fromMe, false);
  assert.equal(q.key.participant, ME_LID);
});

test("sua mensagem citada no privado segue como sua", () => {
  const q = quotedOption(PN, ref({ fromMe: true }))!.quoted;
  assert.equal(q.key.fromMe, true);
  assert.equal(quotedOption(PN, null), undefined);
});
