import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { sameLabelName, Store } from "../server/db.ts";
import { createHandler } from "../server/http.ts";
import { fakeApi, FAKE_TOKEN } from "./fake-api.ts";

const PN = "5511999990000@s.whatsapp.net";
const seed = (store: Store) => store.addMessage({ chatJid: PN, id: "1", rawJid: PN, fromMe: false, at: 1, text: "Quanto custa a cotação para Guarulhos?", kind: "text" }, true);

test("busca na conversa: sem acento, só a conversa pedida, ignora apagadas, recente primeiro", () => {
  const store = new Store(":memory:");
  seed(store);
  const other = "5511888880000@s.whatsapp.net";
  store.addMessage({ chatJid: other, id: "o1", rawJid: other, fromMe: false, at: 2, text: "cotação de outro", kind: "text" }, true);
  store.addMessage({ chatJid: PN, id: "2", rawJid: PN, fromMe: true, at: 3, text: "Cotacao enviada", kind: "text" }, true);
  store.addMessage({ chatJid: PN, id: "3", rawJid: PN, fromMe: true, at: 4, text: "cotação apagada", kind: "text" }, true);
  store.markRevoked(PN, "3");
  assert.deepEqual(store.searchInChat(PN, "cotacao").map((h) => h.id), ["2", "1"]);
  assert.deepEqual(store.searchInChat(PN, "guarulhos").map((h) => h.id), ["1"]);
  assert.deepEqual(store.searchInChat(PN, "   "), []);
});

test("etiquetas do celular: liga pelo nome sem acento, renomeia em cascata, apagar desliga, importa as novas", () => {
  const store = new Store(":memory:");
  seed(store);
  assert.ok(sameLabelName("Cotacao", "Cotação"));
  // Liga à local "Cotação" existente (padrão) pelo nome.
  assert.equal(store.applyWaLabel({ id: "7", name: "cotacao", color: 2 }), true);
  assert.equal(store.listLabels().find((l) => l.name === "Cotação")?.waId, "7");
  // Renomear no celular renomeia a local e as conversas que a usam.
  store.updateChat(PN, { label: "Cotação" });
  assert.equal(store.applyWaLabel({ id: "7", name: "Orçamento", color: 2 }), true);
  assert.equal(store.getChat(PN)?.label, "Orçamento");
  assert.ok(store.listLabels().some((l) => l.name === "Orçamento" && l.waId === "7"));
  // Apagar no celular só desliga.
  assert.equal(store.applyWaLabel({ id: "7", name: "Orçamento", deleted: true }), true);
  assert.equal(store.listLabels().find((l) => l.name === "Orçamento")?.waId, null);
  // Etiqueta nova no celular entra na importação; repetir não duplica.
  store.applyWaLabel({ id: "9", name: "VIP", color: 1 });
  assert.deepEqual(store.importWaLabels(), { created: 1, skipped: 0 });
  assert.deepEqual(store.importWaLabels(), { created: 0, skipped: 0 });
  assert.equal(store.listLabels().find((l) => l.name === "VIP")?.waId, "9");
  // saveLabels sem waId preserva o elo pelo nome.
  store.saveLabels(store.listLabels().map(({ name, description }) => ({ name, description })));
  assert.equal(store.listLabels().find((l) => l.name === "VIP")?.waId, "9");
});

test("associação vinda do celular é idempotente e promove a extra quando a principal sai; diff para o celular", () => {
  const store = new Store(":memory:");
  seed(store);
  store.applyWaLabel({ id: "9", name: "VIP" });
  store.importWaLabels();
  store.applyWaLabel({ id: "7", name: "Cotação" });
  assert.equal(store.applyWaAssociation(PN, "nao-ligada", true), null);
  assert.equal(store.applyWaAssociation(PN, "9", true)?.label, "VIP");
  assert.equal(store.applyWaAssociation(PN, "9", true), null, "repetido não muda nada");
  assert.deepEqual(store.applyWaAssociation(PN, "7", true)?.extraLabels, ["Cotação"]);
  const promoted = store.applyWaAssociation(PN, "9", false);
  assert.equal(promoted?.label, "Cotação");
  assert.deepEqual(promoted?.extraLabels, []);
  const before = store.getChat(PN)!;
  const after = store.updateChat(PN, { label: "VIP", extraLabels: [] })!;
  assert.deepEqual(store.waLabelDiff(before, after), { add: ["9"], remove: ["7"] });
});

test("HTTP: PATCH de etiqueta avisa o celular com o diff; /search e /labels/import respondem", async () => {
  const store = new Store(":memory:");
  seed(store);
  store.applyWaLabel({ id: "9", name: "VIP" });
  store.importWaLabels();
  const synced: unknown[] = [];
  const api = fakeApi(store, { syncLabels: (jid, add, remove) => void synced.push([jid, add, remove]), businessLabels: async () => ({ found: 1 }) });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${api.port}`;
  const headers = { "x-inbox-token": FAKE_TOKEN, "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/api/chats/${encodeURIComponent(PN)}`, { method: "PATCH", headers, body: JSON.stringify({ label: "VIP" }) })).status, 200);
    assert.equal((await fetch(`${base}/api/chats/${encodeURIComponent(PN)}`, { method: "PATCH", headers, body: JSON.stringify({ label: "Reserva" }) })).status, 200);
    assert.deepEqual(synced, [[PN, ["9"], []], [PN, [], ["9"]]]);
    const hits = (await (await fetch(`${base}/api/chats/${encodeURIComponent(PN)}/search?q=cotacao`, { headers })).json()) as { id: string }[];
    assert.deepEqual(hits.map((h) => h.id), ["1"]);
    const imported = (await (await fetch(`${base}/api/labels/import`, { method: "POST", headers, body: "{}" })).json()) as { found: number; created: number };
    assert.equal(imported.found, 1);
  } finally {
    server.close();
  }
});
