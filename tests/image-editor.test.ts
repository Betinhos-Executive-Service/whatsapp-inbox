import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addLayer, blurBlock, canEditImage, clampRect, commit, editedName, exportType, initialState, isDirty, outputSize, outToSrc,
  rectOutToSrc, rectSrcToOut, redo, removeLayer, replaceLayer, resetGeometry, rotate, setCrop, srcToOut, startHistory,
  toggleFlip, undo, type EditState, type Point, type Rotation, type TextLayer,
} from "../ui/image-editor/model.ts";

const near = (a: Point, b: Point) =>
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

test("editor: giro de 90° troca largura e altura e leva o canto superior esquerdo para a direita", () => {
  const s = rotate(initialState(100, 50));
  assert.deepEqual(outputSize(s), { width: 50, height: 100 });
  near(srcToOut(s, { x: 0, y: 0 }), { x: 50, y: 0 });
  near(srcToOut(s, { x: 100, y: 50 }), { x: 0, y: 100 });
});

test("editor: espelho inverte o eixo x dentro do recorte", () => {
  const s = toggleFlip(setCrop(initialState(100, 50), { x: 10, y: 0, w: 40, h: 50 }));
  near(srcToOut(s, { x: 10, y: 5 }), { x: 40, y: 5 });
  near(srcToOut(s, { x: 50, y: 5 }), { x: 0, y: 5 });
});

test("editor: outToSrc desfaz srcToOut em todos os giros, com e sem espelho", () => {
  for (const flip of [false, true]) {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const s: EditState = { ...setCrop(initialState(300, 200), { x: 20, y: 30, w: 120, h: 80 }), rotation, flip };
      near(outToSrc(s, srcToOut(s, { x: 57, y: 61 })), { x: 57, y: 61 });
      assert.deepEqual(rectOutToSrc(s, rectSrcToOut(s, { x: 30, y: 40, w: 50, h: 20 })), { x: 30, y: 40, w: 50, h: 20 });
    }
  }
});

test("editor: histórico desfaz, refaz e descarta o futuro ao editar de novo", () => {
  const a = initialState(10, 10);
  let h = startHistory(a);
  assert.equal(isDirty(h), false);
  const b = rotate(a);
  h = commit(h, b);
  assert.equal(isDirty(h), true);
  h = undo(h);
  assert.equal(h.present, a);
  assert.equal(isDirty(h), false);
  h = redo(h);
  assert.equal(h.present, b);
  h = commit(undo(h), toggleFlip(a));
  assert.equal(h.future.length, 0);
  assert.equal(undo(startHistory(a)).present, a);
  assert.equal(redo(startHistory(a)).present, a);
});

test("editor: histórico guarda no máximo 50 passos", () => {
  let h = startHistory(initialState(10, 10));
  for (let i = 0; i < 60; i++) h = commit(h, rotate(h.present));
  assert.equal(h.past.length, 50);
});

test("editor: recorte fica dentro da imagem e respeita o tamanho mínimo", () => {
  assert.deepEqual(setCrop(initialState(100, 80), { x: -5, y: 70, w: 500, h: 2 }).crop, { x: 0, y: 64, w: 100, h: 16 });
  assert.deepEqual(setCrop(initialState(10, 10), { x: 3, y: 3, w: 1, h: 1 }).crop, { x: 0, y: 0, w: 10, h: 10 });
  assert.deepEqual(clampRect(initialState(100, 80), { x: -10, y: 70, w: 50, h: 50 }), { x: 0, y: 70, w: 40, h: 10 });
});

test("editor: restaurar volta recorte, giro e espelho, mas mantém as camadas", () => {
  const t: TextLayer = { kind: "text", id: 1, color: "#000", size: 20, text: "oi", at: { x: 5, y: 5 } };
  const s = resetGeometry(addLayer(toggleFlip(rotate(setCrop(initialState(100, 80), { x: 10, y: 10, w: 20, h: 20 }))), t));
  assert.deepEqual(s, { ...initialState(100, 80), layers: [t] });
});

test("editor: camadas entram, mudam e saem pelo id", () => {
  const t: TextLayer = { kind: "text", id: 1, color: "#000", size: 20, text: "oi", at: { x: 5, y: 5 } };
  let s = addLayer(initialState(10, 10), t);
  s = replaceLayer(s, { ...t, text: "olá" });
  assert.equal(s.layers[0].kind === "text" && s.layers[0].text, "olá");
  assert.equal(removeLayer(s, 1).layers.length, 0);
});

test("editor: bloco do borrado cresce com a área e nunca fica abaixo de 6 px", () => {
  assert.equal(blurBlock({ x: 0, y: 0, w: 20, h: 20 }), 6);
  assert.equal(blurBlock({ x: 0, y: 0, w: 400, h: 200 }), 20);
});

test("exportação: PNG continua PNG; o resto vira JPEG com sufixo -editada", () => {
  assert.equal(exportType("image/png"), "image/png");
  assert.equal(exportType("image/webp"), "image/jpeg");
  assert.equal(editedName("foto.PNG", "image/png"), "foto-editada.png");
  assert.equal(editedName("recibo.webp", "image/webp"), "recibo-editada.jpg");
  assert.equal(editedName("foto-editada.jpg", "image/jpeg"), "foto-editada.jpg");
  assert.equal(editedName("", "image/jpeg"), "imagem-editada.jpg");
  assert.equal(canEditImage("image/gif"), false);
  assert.equal(canEditImage("image/jpeg"), true);
});
