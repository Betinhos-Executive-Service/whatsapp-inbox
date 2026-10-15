import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { createHandler } from "../server/http.ts";
import { fakeApi } from "./fake-api.ts";

const PN = "5511999990000@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const JSON_HEADERS = { "content-type": "application/json" };

test("Store: apagar conversa leva mensagens junto", () => {
  const store = new Store(":memory:");
  store.addMessage({ chatJid: PN, id: "m1", rawJid: PN, fromMe: false, at: Date.now(), text: "Oi", kind: "text" }, true);
  assert.equal(store.deleteChat(PN), true);
  assert.equal(store.hasChat(PN), false);
  assert.equal(store.messageKey(PN, "m1"), null);
  assert.equal(store.deleteChat(PN), false);
});

test("HTTP: sair do grupo e apagar conversa", async () => {
  const store = new Store(":memory:");
  store.ensureChat(PN, { status: "aberta" });
  store.ensureChat(GROUP, { status: "aberta" });
  const left: string[] = [];
  const deleted: string[] = [];
  const api = fakeApi(store, {
    leaveGroup: async (jid) => void left.push(jid),
    deleteChat: async (jid) => (deleted.push(jid), { synced: false }),
  });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as AddressInfo).port;
  const chat = (jid: string) => `http://127.0.0.1:${api.port}/api/chats/${encodeURIComponent(jid)}`;
  try {
    assert.equal((await fetch(`${chat(PN)}/leave`, { method: "POST", body: "{}", headers: JSON_HEADERS })).status, 400);
    assert.equal((await fetch(`${chat(GROUP)}/leave`, { method: "POST", body: "{}", headers: JSON_HEADERS })).status, 200);
    assert.deepEqual(left, [GROUP]);

    const res = await fetch(chat(PN), { method: "DELETE", body: "{}", headers: JSON_HEADERS });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { synced: false });
    assert.deepEqual(deleted, [PN]);
    assert.equal((await fetch(chat("5511000000000@s.whatsapp.net"), { method: "DELETE", body: "{}", headers: JSON_HEADERS })).status, 404);
  } finally {
    server.close();
  }
});
