import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { buildState } from "../server/jev.ts";
import { extractMedia } from "../server/text.ts";

const PN = "5511999990000@s.whatsapp.net";
const OTHER = "5511888880000@s.whatsapp.net";

test("mídia: referência guardada no banco, sem chave na mensagem que vai para a tela", () => {
  const ref = extractMedia({ imageMessage: { mediaKey: new Uint8Array([1, 2, 3]), directPath: "/v/x", mimetype: "image/jpeg; codecs", fileLength: 10 } });
  assert.equal(ref?.type, "image");
  assert.equal(ref?.mimetype, "image/jpeg");
  assert.equal(extractMedia({ imageMessage: { caption: "sem chave" } }), null);
  assert.equal(extractMedia({ conversation: "oi" }), null);
  const s = new Store(":memory:");
  const r = s.addMessage({ chatJid: PN, id: "a", rawJid: PN, fromMe: false, at: 1, text: "[Imagem]", kind: "image", media: JSON.stringify(ref) }, true);
  assert.deepEqual(r?.message.media, { type: "image", mimetype: "image/jpeg", fileName: null, size: 10, seconds: null, ptt: false, waveform: null, album: null });
  assert.ok(!JSON.stringify(r?.message).includes("mediaKey"));
  assert.ok(s.getMediaRef(PN, "a")?.includes("mediaKey"));
});

test("Jev aprende com a etiqueta escolhida à mão (exemplo de outra conversa, até 2 por etiqueta)", () => {
  const s = new Store(":memory:");
  const add = (jid: string, id: string, text: string) => s.addMessage({ chatJid: jid, id, rawJid: jid, fromMe: false, at: Number(id.length), text, kind: "text" }, false);
  add(OTHER, "1", "Quanto fica um carro executivo para Campinas?");
  s.updateChat(OTHER, { label: "Cotação" });
  add(PN, "1", "oi");
  s.updateChat(PN, { label: "Reserva" });
  assert.deepEqual(s.labelExamples(PN), [{ label: "Cotação", snippet: "Quanto fica um carro executivo para Campinas?" }]);
  const state = JSON.parse(buildState("Ana", [], new Date(0), s.labelExamples(PN)));
  assert.equal(state.exemplos_de_etiquetas_corrigidas_pelo_usuario[0].etiqueta, "Cotação");
});

test("mídias do perfil: fotos/vídeos e documentos separados, mais recentes primeiro, com paginação", () => {
  const s = new Store(":memory:");
  const add = (id: string, at: number, type: string) =>
    s.addMessage({ chatJid: PN, id, rawJid: PN, fromMe: false, at, text: `[${type}]`, kind: type, media: JSON.stringify({ type, mimetype: "x/y", mediaKey: "k", directPath: "/p" }) }, false);
  add("img", 1, "image");
  add("vid", 2, "video");
  add("doc", 3, "document");
  add("aud", 4, "audio");
  s.addMessage({ chatJid: PN, id: "txt", rawJid: PN, fromMe: false, at: 5, text: "oi", kind: "text" }, false);
  assert.deepEqual(s.listMedia(PN, "visual", null).map((m) => m.id), ["vid", "img"]);
  assert.deepEqual(s.listMedia(PN, "docs", null).map((m) => m.id), ["doc"]);
  assert.deepEqual(s.listMedia(PN, "visual", 2).map((m) => m.id), ["img"]);
  assert.deepEqual(s.listMedia(OTHER, "visual", null), []);
});

test("mídias da conversa: links, busca por nome do arquivo e filtro enviado/recebido", () => {
  const s = new Store(":memory:");
  const doc = (id: string, at: number, fileName: string, fromMe: boolean) =>
    s.addMessage({ chatJid: PN, id, rawJid: PN, fromMe, at, text: `[Documento] ${fileName}`, kind: "document", media: JSON.stringify({ type: "document", mimetype: "application/pdf", fileName, mediaKey: "k", directPath: "/p" }) }, false);
  doc("d1", 1, "Voucher_Itau.pdf", false);
  doc("d2", 2, "Fatura 100%.pdf", true);
  doc("d3", 3, "voucher-azul.pdf", true);
  const text = (id: string, at: number, body: string, fromMe = false) => s.addMessage({ chatJid: PN, id, rawJid: PN, fromMe, at, text: body, kind: "text" }, false);
  text("l1", 4, "Segue o mapa https://maps.app.goo.gl/abc");
  text("l2", 5, "Ana: veja www.betinhos.com.br", true);
  text("t1", 6, "sem link nenhum");
  assert.deepEqual(s.listMedia(PN, "docs", null, { q: "voucher" }).map((m) => m.id), ["d3", "d1"]);
  assert.deepEqual(s.listMedia(PN, "docs", null, { q: "100%" }).map((m) => m.id), ["d2"]);
  assert.deepEqual(s.listMedia(PN, "docs", null, { from: "me" }).map((m) => m.id), ["d3", "d2"]);
  assert.deepEqual(s.listMedia(PN, "docs", null, { from: "them" }).map((m) => m.id), ["d1"]);
  assert.deepEqual(s.listMedia(PN, "links", null).map((m) => m.id), ["l2", "l1"]);
  assert.deepEqual(s.listMedia(PN, "links", null, { q: "maps" }).map((m) => m.id), ["l1"]);
});
