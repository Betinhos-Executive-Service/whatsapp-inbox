import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Store, type IncomingMessage } from "../server/db.ts";
import { createHandler } from "../server/http.ts";
import { buildQuestions, buildState, parseResponse } from "../server/jev.ts";
import { extractText } from "../server/text.ts";
import { FAKE_TOKEN, fakeApi } from "./fake-api.ts";

const PN = "5511999990000@s.whatsapp.net";
const LID = "123456789@lid";
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

test("lote do histórico numa transação: falha de uma gravação aninhada não desfaz as outras", () => {
  const s = new Store(":memory:");
  s.tx(() => {
    s.addMessage(msg({ text: "primeira" }), false);
    assert.throws(() => s.tx(() => {
      s.addMessage(msg({ text: "desfeita" }), false);
      throw new Error("falha");
    }));
    s.addMessage(msg({ text: "terceira" }), false);
  });
  assert.equal(s.listMessages(PN, null).length, 2);
  assert.ok(!s.listMessages(PN, null).some((m) => m.text === "desfeita"));
});

test("mensagem nova reabre a conversa e conta não lida; resposta minha passa a aguardando", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  assert.equal(s.getChat(PN)?.status, "aberta");
  assert.equal(s.getChat(PN)?.unread, 1);
  s.addMessage(msg({ fromMe: true }), true);
  assert.equal(s.getChat(PN)?.status, "aguardando");
  assert.equal(s.getChat(PN)?.unread, 0);
  s.updateChat(PN, { status: "resolvida" });
  s.addMessage(msg({ text: "Mais uma dúvida" }), true);
  assert.equal(s.getChat(PN)?.status, "aberta");
  assert.equal(s.getChat(PN)?.lastText, "Mais uma dúvida");
});

test("histórico não mexe em status nem em não lidas e não duplica", () => {
  const s = new Store(":memory:");
  const m = msg({ at: 1000 });
  assert.ok(s.addMessage(m, false));
  assert.equal(s.addMessage(m, false), null);
  assert.equal(s.getChat(PN)?.status, "resolvida");
  assert.equal(s.getChat(PN)?.unread, 0);
  // Mensagem antiga não sobrescreve a prévia mais nova
  s.addMessage(msg({ at: 5000, text: "nova" }), false);
  s.addMessage(msg({ at: 2000, text: "velha" }), false);
  assert.equal(s.getChat(PN)?.lastText, "nova");
});

test("conversa aberta pelo LID é fundida na do número quando o par aparece", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ chatJid: PN, at: 1000, text: "pelo número" }), true);
  s.addMessage(msg({ chatJid: LID, rawJid: LID, at: 2000, text: "pelo lid" }), true);
  const merged = s.mapLid(LID, PN);
  assert.equal(merged?.jid, PN);
  assert.equal(merged?.unread, 2);
  assert.equal(merged?.lastText, "pelo lid");
  assert.equal(s.getChat(LID), null);
  assert.equal(s.listMessages(PN, null).length, 2);
  assert.equal(s.pnForLid(LID), PN);
});

test("etiqueta manual não é sobrescrita pelo Jev; etiqueta removida sai das conversas", () => {
  const s = new Store(":memory:");
  s.addMessage(msg(), true);
  s.saveClassification(PN, { label: "Cotação", confidence: 0.9, needsReply: 0.8, urgent: 0.1 });
  assert.equal(s.getChat(PN)?.label, "Cotação");
  assert.equal(s.getChat(PN)?.labelSource, "jev");
  s.updateChat(PN, { label: "Reserva" });
  s.saveClassification(PN, { label: "Financeiro", confidence: 0.7, needsReply: 0.2, urgent: 0.1 });
  assert.equal(s.getChat(PN)?.label, "Reserva");
  assert.equal(s.getChat(PN)?.ai?.label, "Financeiro");
  s.saveLabels([{ name: "Cotação", description: "" }, { name: "Outros", description: "" }]);
  assert.equal(s.getChat(PN)?.label, null);
});

test("nome que chega antes da conversa é herdado; conversa vazia fica fora da lista", () => {
  const s = new Store(":memory:");
  s.setNames(PN, { saved: "Ana Agenda" });
  s.setNames(LID, { push: "Ana pelo LID" });
  s.ensureChat("5511888880000@s.whatsapp.net");
  s.addMessage(msg(), false);
  assert.equal(s.getChat(PN)?.name, "Ana Agenda");
  assert.deepEqual(s.listChats().map((c) => c.jid), [PN]);
  const other = "5511777770000@s.whatsapp.net";
  s.addMessage(msg({ chatJid: other, rawJid: other }), false);
  s.mapLid(LID, other);
  assert.equal(s.getChat(other)?.name, "Ana pelo LID");
});

test("trocar o número no QR apaga as conversas do número anterior; o mesmo número mantém", () => {
  const s = new Store(":memory:");
  assert.equal(s.switchAccount("5511000000001"), false);
  s.addMessage(msg(), true);
  s.setNames(PN, { saved: "Ana" });
  s.saveLabels([{ name: "Cotação", description: "" }, { name: "Outros", description: "" }]);
  s.setSetting("jev_api_key", "chave-de-teste-local");
  assert.equal(s.switchAccount("5511000000001"), false);
  assert.equal(s.listChats().length, 1);
  assert.equal(s.switchAccount("5511000000002"), true);
  assert.equal(s.listChats().length, 0);
  assert.equal(s.listMessages(PN, null).length, 0);
  // Etiquetas e configurações não são do número: ficam.
  assert.equal(s.listLabels().length, 2);
  assert.equal(s.getSetting("jev_api_key"), "chave-de-teste-local");
  assert.equal(s.getSetting("account"), "5511000000002");
});

test("markRead devolve as chaves das não lidas e zera o contador", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a", at: 1 }), true);
  s.addMessage(msg({ id: "b", at: 2 }), true);
  const keys = s.markRead(PN);
  assert.deepEqual(keys.map((k) => k.id).sort(), ["a", "b"]);
  assert.equal(s.getChat(PN)?.unread, 0);
  assert.deepEqual(s.markRead(PN), []);
});

test("extractText cobre texto, mídia e ignora protocolo/reação", () => {
  assert.deepEqual(extractText({ conversation: "oi" }), { text: "oi", kind: "text" });
  assert.deepEqual(extractText({ extendedTextMessage: { text: "link" } }), { text: "link", kind: "text" });
  assert.deepEqual(extractText({ imageMessage: { caption: "nota" } }), { text: "[Imagem] nota", kind: "image" });
  assert.deepEqual(extractText({ audioMessage: { ptt: true } }), { text: "[Áudio]", kind: "audio" });
  assert.deepEqual(extractText({ documentMessage: { fileName: "nf.pdf" } }), { text: "[Documento] nf.pdf", kind: "document" });
  assert.equal(extractText({ reactionMessage: { text: "👍" } }), null);
  assert.equal(extractText({ protocolMessage: { type: 0 } }), null);
  assert.equal(extractText({ conversation: "  " }), null);
  assert.equal(extractText(null), null);
});

test("visualização única aparece como aviso, sem mídia", () => {
  assert.deepEqual(extractText({ imageMessage: { viewOnce: true, caption: "x" } }), { text: "[Foto de visualização única] Abra no celular para ver.", kind: "view_once" });
  assert.equal(extractText({ videoMessage: { viewOnce: true } })?.kind, "view_once");
  assert.equal(extractText({ imageMessage: { caption: "oi" } })?.kind, "image");
});

test("Jev: perguntas, estado e resposta validados", () => {
  const labels = [{ name: "Cotação", description: "Preço" }, { name: "Outros", description: "" }];
  assert.throws(() => buildQuestions(labels.slice(0, 1)));
  const q = buildQuestions(labels);
  assert.deepEqual(Object.keys(q), ["etiqueta", "responder", "urgente", "prioridade"]);
  const state = JSON.parse(buildState("Ana", [{ chatJid: PN, id: "1", fromMe: false, at: 0, text: "x".repeat(2000), kind: "text", media: null, contacts: null, quoted: null, deleted: false, sender: null, ack: null, editedAt: null, reactions: [], extra: null, poll: null, starred: false }]));
  assert.equal(state.mensagens[0].de, "contato");
  assert.equal(state.mensagens[0].texto.length, 1000);
  assert.ok(!JSON.stringify(state).includes("whatsapp.net"));
  assert.equal(state.tipo, "conversa individual");
  assert.equal(state.eu_respondi_por_ultimo, false);
  assert.match(state.agora, /horário de Brasília/);
  // Em grupo, quem fala é "participante"; datas vão no horário de Brasília (00:00 UTC = 21:00 do dia anterior).
  const group = JSON.parse(buildState("Turma", [{ chatJid: PN, id: "1", fromMe: false, at: 0, text: "oi", kind: "text", media: null, contacts: null, quoted: null, deleted: false, sender: null, ack: null, editedAt: null, reactions: [], extra: null, poll: null, starred: false }], new Date(0), [], { messages: 30, chars: 1000 }, true));
  assert.equal(group.tipo, "grupo");
  assert.equal(group.mensagens[0].de, "participante");
  assert.match(group.mensagens[0].em, /31\/12\/1969 21:00/);
  const ok = {
    answers: {
      etiqueta: { type: "choice", choice: "Cotação", confidence: 0.82, probabilities: {} },
      responder: { type: "noul", noul: 0.9 },
      urgente: { type: "noul", noul: 0.1 },
      prioridade: { type: "choice", choice: "media", confidence: 0.7, probabilities: {} },
    },
  };
  assert.deepEqual(parseResponse(ok, labels), { label: "Cotação", confidence: 0.82, needsReply: 0.9, urgent: 0.1, priority: "media", reason: null });
  assert.throws(() => parseResponse({ ...ok, answers: { ...ok.answers, prioridade: { type: "choice", choice: "urgentíssima" } } }, labels));
  // Prioridade baixa com "urgente" alto é contradição: a urgência é limitada a 0,3.
  const low = parseResponse({ ...ok, answers: { ...ok.answers, urgente: { type: "noul", noul: 0.9 }, prioridade: { type: "choice", choice: "baixa", confidence: 0.8, probabilities: {} } } }, labels);
  assert.equal(low.urgent, 0.3);
  assert.throws(() => parseResponse({ ...ok, answers: { ...ok.answers, etiqueta: { ...ok.answers.etiqueta, choice: "Inventada" } } }, labels));
});

test("HTTP: bloqueia Host/Origin estranhos e escrita sem JSON; valida etiquetas", async () => {
  const store = new Store(":memory:");
  store.addMessage(msg(), true);
  let port = 0;
  const sentMedia: { body: Buffer; mimetype: string; fileName: string; ptt?: boolean }[] = [];
  const api = fakeApi(store, { sendMedia: async (_jid, file) => void sentMedia.push(file) });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  api.port = port;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/api/chats`)).status, 200);
    // Token local (servidor MCP): substitui o Origin; errado é recusado até em GET.
    assert.equal((await fetch(`${base}/api/chats`, { headers: { "x-inbox-token": FAKE_TOKEN } })).status, 200);
    assert.equal((await fetch(`${base}/api/chats`, { headers: { "x-inbox-token": "errado" } })).status, 403);
    assert.equal((await fetch(`${base}/api/logout`, { method: "POST", body: "{}", headers: { "content-type": "application/json", origin: "http://evil.example", "x-inbox-token": FAKE_TOKEN } })).status, 200);
    assert.equal((await fetch(`${base}/api/logout`, { method: "POST", body: "{}", headers: { "content-type": "application/json", "x-inbox-token": "x".repeat(64) } })).status, 403);
    assert.equal((await fetch(`${base}/api/logout`, { method: "POST", body: "{}", headers: { "content-type": "text/plain", "x-inbox-token": FAKE_TOKEN } })).status, 415);
    const part = await fetch(`${base}/api/media/${encodeURIComponent(PN)}/X1`, { headers: { range: "bytes=2-5" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await part.text(), "2345");
    assert.equal((await fetch(`${base}/api/media/${encodeURIComponent(PN)}/X1`, { headers: { range: "bytes=50-" } })).status, 416);
    // fetch descarta o cabeçalho Host; node:http envia o que pedimos (simula DNS rebinding).
    const evilStatus = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/chats", headers: { host: "evil.example", "x-inbox-token": FAKE_TOKEN } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(evilStatus, 403);
    assert.equal((await fetch(`${base}/api/logout`, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal(
      (await fetch(`${base}/api/logout`, { method: "POST", body: "{}", headers: { "content-type": "application/json", origin: "http://evil.example" } })).status,
      403,
    );
    const bad = await fetch(`${base}/api/labels`, {
      method: "PUT",
      body: JSON.stringify([{ name: "A", description: "" }, { name: "a", description: "" }]),
      headers: { "content-type": "application/json" },
    });
    assert.equal(bad.status, 400);
    const patch = await fetch(`${base}/api/chats/${encodeURIComponent(PN)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "resolvida", label: "Cotação" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).status, "resolvida");
    assert.equal((await fetch(`${base}/api/chats/nao-existe/messages`)).status, 404);
    const media = await fetch(`${base}/api/chats/${encodeURIComponent(PN)}/send-media`, {
      method: "POST",
      body: JSON.stringify({ fileName: "voz.ogg", mimetype: "audio/ogg", data: Buffer.from("abc").toString("base64"), ptt: true, seconds: 3 }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(media.status, 200);
    assert.equal(sentMedia[0].body.toString(), "abc");
    assert.equal(sentMedia[0].ptt, true);
    const post = (action: string, body: unknown) =>
      fetch(`${base}/api/chats/${encodeURIComponent(PN)}/${action}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    assert.equal((await post("forward", { id: "x", to: "nao-existe@s.whatsapp.net" })).status, 404, "destino precisa existir");
    assert.equal((await post("forward", { id: "nao-existe", to: PN })).status, 404, "mensagem precisa existir");
    assert.equal((await post("typing", { state: "gritando" })).status, 400);
    assert.equal((await post("edit", { id: "x", text: "   " })).status, 400);
    const patchChat = (body: unknown) =>
      fetch(`${base}/api/chats/${encodeURIComponent(PN)}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    assert.equal((await patchChat({ extraLabels: ["Inventada"] })).status, 400);
    assert.equal((await patchChat({ snoozedUntil: 1000 })).status, 400, "adiar para o passado");
    assert.deepEqual((await (await patchChat({ extraLabels: ["Reserva"], pinned: true })).json()).extraLabels, ["Reserva"]);
    assert.ok(Array.isArray(await (await fetch(`${base}/api/search?q=ol%C3%A1`)).json()));
  } finally {
    server.close();
  }
});
