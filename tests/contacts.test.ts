import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVcard, extractContacts, parseVcard } from "../server/contacts.ts";

test("vCard: lê nome, telefones e waid", () => {
  const v = "BEGIN:VCARD\nVERSION:3.0\nN:Silva;Ana;;;\nFN:Ana Silva\nitem1.TEL;waid=5511988887777:+55 11 98888-7777\nTEL;type=HOME:+55 21 3333-4444\nEND:VCARD";
  assert.deepEqual(parseVcard(v), { name: "Ana Silva", phones: [{ number: "+55 11 98888-7777", wa: "5511988887777" }, { number: "+55 21 3333-4444", wa: null }] });
  assert.equal(parseVcard("BEGIN:VCARD\nN:Souza;Bia\nEND:VCARD").name, "Bia Souza");
});

test("vCard: ida e volta mantém nome com vírgula e número", () => {
  const card = parseVcard(buildVcard("Betinhos, Operação", "+55 (11) 98888-7777"));
  assert.deepEqual(card, { name: "Betinhos, Operação", phones: [{ number: "+5511988887777", wa: "5511988887777" }] });
});

test("contatos: um ou vários na mensagem", () => {
  const v = buildVcard("Ana", "5511988887777");
  assert.equal(extractContacts({ contactMessage: { displayName: "Ana", vcard: v } })?.length, 1);
  assert.equal(extractContacts({ contactsArrayMessage: { contacts: [{ vcard: v }, { vcard: v }] } })?.length, 2);
  assert.equal(extractContacts({ conversation: "oi" }), null);
});
