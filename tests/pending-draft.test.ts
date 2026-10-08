import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Store, type IncomingMessage } from "../server/db.ts";
import { createHandler } from "../server/http.ts";
import { fakeApi } from "./fake-api.ts";

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
const JSON_HEADERS = { "content-type": "application/json" };

test("HTTP: rascunho pendente — propor, ler, enviar e descartar", async () => {
  const store = new Store(":memory:");
  store.addMessage(msg({ id: "q1", text: "Tem carro amanhã?" }), true);
  const sent: { jid: string; text: string; quotedId?: string }[] = [];
  const sentMedia: { fileName: string; mimetype: string; caption?: string; size: number }[] = [];
  const changed: string[] = [];
  const api = fakeApi(store, {
    send: async (jid, text, opts) => void sent.push({ jid, text, quotedId: opts.quotedId }),
    sendMedia: async (_jid, file) => void sentMedia.push({ fileName: file.fileName, mimetype: file.mimetype, caption: file.caption, size: file.body.length }),
    onChatChanged: (jid) => void changed.push(jid),
  });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as AddressInfo).port;
  const chat = `http://127.0.0.1:${api.port}/api/chats/${encodeURIComponent(PN)}`;
  try {
    // Sem rascunho: 404 em GET, enviar e mídia.
    assert.equal((await fetch(`${chat}/pending-draft`)).status, 404);
    assert.equal((await fetch(`${chat}/pending-draft/send`, { method: "POST", body: "{}", headers: JSON_HEADERS })).status, 404);

    // Propor texto vazio sem anexo é recusado; citação inexistente também.
    assert.equal((await fetch(`${chat}/pending-draft`, { method: "PUT", body: JSON.stringify({ text: "  " }), headers: JSON_HEADERS })).status, 400);
    assert.equal((await fetch(`${chat}/pending-draft`, { method: "PUT", body: JSON.stringify({ text: "Oi", quotedId: "nao" }), headers: JSON_HEADERS })).status, 404);

    // Propor com citação: a conversa volta com o resumo e a tela é avisada.
    const put = await fetch(`${chat}/pending-draft`, { method: "PUT", body: JSON.stringify({ text: "Sim, temos. Qual horário?", quotedId: "q1" }), headers: JSON_HEADERS });
    assert.equal(put.status, 200);
    const summary = (await put.json()).pendingDraft;
    assert.equal(summary.text, "Sim, temos. Qual horário?");
    assert.equal(summary.hasMedia, false);
    assert.equal(summary.source, "claude");
    assert.deepEqual(changed, [PN]);

    const got = await (await fetch(`${chat}/pending-draft`)).json();
    assert.equal(got.quotedId, "q1");
    assert.equal(got.quoted?.text, "Tem carro amanhã?");
    assert.equal(got.media, null);
    assert.equal((await fetch(`${chat}/pending-draft/media`)).status, 404);

    // Enviar usa o envio de texto com a citação e limpa o rascunho.
    const send = await fetch(`${chat}/pending-draft/send`, { method: "POST", body: "{}", headers: JSON_HEADERS });
    assert.equal(send.status, 200);
    assert.deepEqual(sent, [{ jid: PN, text: "Sim, temos. Qual horário?", quotedId: "q1" }]);
    assert.equal((await send.json()).pendingDraft, null);
    assert.equal(store.getPendingDraft(PN), null);

    // Com anexo: a mídia é servida e o envio vai pelo sendMedia com legenda.
    const data = Buffer.from("imagem-falsa").toString("base64");
    const putMedia = await fetch(`${chat}/pending-draft`, { method: "PUT", body: JSON.stringify({ text: "Segue a foto", media: { fileName: "carro.png", mimetype: "image/png", data } }), headers: JSON_HEADERS });
    assert.equal(putMedia.status, 200);
    assert.equal((await putMedia.json()).pendingDraft.hasMedia, true);
    const media = await fetch(`${chat}/pending-draft/media`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/png");
    assert.equal(await media.text(), "imagem-falsa");
    await fetch(`${chat}/pending-draft/send`, { method: "POST", body: "{}", headers: JSON_HEADERS });
    assert.deepEqual(sentMedia, [{ fileName: "carro.png", mimetype: "image/png", caption: "Segue a foto", size: 12 }]);

    // Descartar limpa e avisa a tela.
    await fetch(`${chat}/pending-draft`, { method: "PUT", body: JSON.stringify({ text: "descartável" }), headers: JSON_HEADERS });
    const del = await fetch(`${chat}/pending-draft`, { method: "DELETE", body: "{}", headers: JSON_HEADERS });
    assert.equal(del.status, 200);
    assert.equal((await del.json()).pendingDraft, null);
    assert.equal(changed.length, 6);

    // Falha no envio mantém o rascunho.
    api.send = async () => {
      throw new Error("WhatsApp desconectado");
    };
    await fetch(`${chat}/pending-draft`, { method: "PUT", body: JSON.stringify({ text: "fica" }), headers: JSON_HEADERS });
    assert.equal((await fetch(`${chat}/pending-draft/send`, { method: "POST", body: "{}", headers: JSON_HEADERS })).status, 500);
    assert.equal(store.getPendingDraft(PN)?.text, "fica");

    // ?limit= nas mensagens.
    for (let i = 0; i < 5; i++) store.addMessage(msg(), false);
    assert.equal(((await (await fetch(`${chat}/messages?limit=2`)).json()) as unknown[]).length, 2);
  } finally {
    server.close();
  }
});
