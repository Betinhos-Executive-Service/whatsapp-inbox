import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { buildVcard, extractContacts, parseVcard, saveContact } from "../server/contacts.ts";
import { Store } from "../server/db.ts";
import { createHandler } from "../server/http.ts";
import { fakeApi } from "./fake-api.ts";

const ANA = "5511999990001@s.whatsapp.net";
const BIA = "5511999990002@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const JSON_HEADERS = { "content-type": "application/json" };

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

test("contatos: lista só quem tem nome salvo, sem grupos, em ordem pt-BR", () => {
  const s = new Store(":memory:");
  s.setNames(BIA, { saved: "Ábia" });
  s.setNames(ANA, { saved: "Zeca" });
  s.setNames("5511999990003@s.whatsapp.net", { push: "Só perfil" });
  s.setNames(GROUP, { saved: "Grupo" });
  assert.deepEqual(s.listContacts(), [
    { jid: BIA, name: "Ábia", phone: "5511999990002" },
    { jid: ANA, name: "Zeca", phone: "5511999990001" },
  ]);
});

test("contatos: excluir limpa o nome salvo e mantém o nome do perfil e a conversa", () => {
  const s = new Store(":memory:");
  s.ensureChat(ANA);
  s.setNames(ANA, { saved: "Ana", push: "Aninha" });
  assert.equal(s.getChat(ANA)?.saved, true);
  const chat = s.clearSavedName(ANA);
  assert.equal(chat?.name, "Aninha");
  assert.equal(chat?.saved, false);
  assert.equal(s.savedName(ANA), null);
  assert.deepEqual(s.listContacts(), []);
});

test("contatos: excluir sem conversa não falha", () => {
  const s = new Store(":memory:");
  s.setNames(ANA, { saved: "Ana" });
  assert.equal(s.clearSavedName(ANA), null);
  assert.equal(s.savedName(ANA), null);
});

test("contatos: grupo nunca conta como salvo", () => {
  const s = new Store(":memory:");
  s.ensureChat(GROUP);
  s.setNames(GROUP, { saved: "Grupo" });
  assert.equal(s.getChat(GROUP)?.saved, false);
});

test("salvar contato: WhatsApp primeiro, banco depois", async () => {
  const s = new Store(":memory:");
  const calls: unknown[] = [];
  const saved = await saveContact(
    { resolve: async () => ANA, sync: async (...a) => void calls.push(a), store: s },
    { digits: "5511999990001", firstName: " Ana ", lastName: " Maria Silva " },
  );
  assert.deepEqual(calls, [[ANA, "Ana Maria Silva", "Ana"]]);
  assert.deepEqual(saved, { jid: ANA, name: "Ana Maria Silva", phone: "5511999990001" });
  assert.equal(s.savedName(ANA), "Ana Maria Silva");
});

test("salvar contato: falha do WhatsApp não muda nada aqui", async () => {
  const s = new Store(":memory:");
  await assert.rejects(
    saveContact({ resolve: async () => ANA, sync: async () => { throw new Error("sem chave"); }, store: s }, { digits: "5511999990001", firstName: "Ana" }),
    /sem chave/,
  );
  assert.equal(s.savedName(ANA), null);
});

test("salvar contato: número sem WhatsApp é recusado antes de sincronizar", async () => {
  const s = new Store(":memory:");
  let synced = false;
  await assert.rejects(
    saveContact({ resolve: async () => null, sync: async () => void (synced = true), store: s }, { digits: "5511999990001", firstName: "Ana" }),
    /não tem WhatsApp/,
  );
  assert.equal(synced, false);
});

test("HTTP: rotas de contatos", async () => {
  const store = new Store(":memory:");
  store.setNames(ANA, { saved: "Ana" });
  const deleted: string[] = [];
  const api = fakeApi(store, {
    checkContact: async (phone) => ({ jid: ANA, savedName: phone }),
    saveContact: async (c) => ({ jid: ANA, name: c.firstName, phone: "5511999990001" }),
    deleteContact: async (jid) => void deleted.push(jid),
  });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as AddressInfo).port;
  const url = (p: string) => `http://127.0.0.1:${api.port}${p}`;
  try {
    assert.deepEqual(await (await fetch(url("/api/contacts"))).json(), [{ jid: ANA, name: "Ana", phone: "5511999990001" }]);
    assert.deepEqual(await (await fetch(url("/api/contacts/check?phone=11999990001"))).json(), { jid: ANA, savedName: "11999990001" });
    assert.equal((await fetch(url("/api/contacts/check"))).status, 400);
    const post = (body: unknown) => fetch(url("/api/contacts"), { method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS });
    assert.equal((await post({ phone: "11999990001", firstName: "Ana" })).status, 200);
    assert.equal((await post({ phone: "11999990001", firstName: "  " })).status, 400);
    assert.equal((await post({ phone: "", firstName: "Ana" })).status, 400);
    assert.equal((await fetch(url(`/api/contacts/${encodeURIComponent(ANA)}`), { method: "DELETE", body: "{}", headers: JSON_HEADERS })).status, 204);
    assert.deepEqual(deleted, [ANA]);
    assert.equal((await fetch(url(`/api/contacts/${encodeURIComponent(GROUP)}`), { method: "DELETE", body: "{}", headers: JSON_HEADERS })).status, 400);
  } finally {
    server.close();
  }
});
