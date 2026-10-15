import assert from "node:assert/strict";
import { test } from "node:test";
import { VIEW_ONCE_KIND, viewOnceText, viewOnceWrapper } from "../server/text.ts";

test("visualização única: reconhece o embrulho da mensagem enviada por este número", () => {
  assert.equal(viewOnceWrapper({ viewOnceMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } } }), "imageMessage");
  assert.equal(viewOnceWrapper({ viewOnceMessageV2: { message: { videoMessage: {} } } }), "videoMessage");
  assert.equal(viewOnceWrapper({ viewOnceMessageV2Extension: { message: { audioMessage: {} } } }), "audioMessage");
  assert.equal(viewOnceWrapper({ viewOnceMessage: { message: { documentMessage: {} } } }), null);
  assert.equal(viewOnceWrapper({ imageMessage: {} }), null);
  assert.equal(viewOnceWrapper(null), null);
});

test("visualização única: a enviada registra só o aviso; a recebida manda abrir no celular", () => {
  assert.deepEqual(viewOnceText("Foto", true), { text: "[Foto de visualização única]", kind: VIEW_ONCE_KIND });
  assert.equal(viewOnceText("Vídeo").text, "[Vídeo de visualização única] Abra no celular para ver.");
});
