# Editor de imagem — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** editar imagens dentro do app antes de enviar (cortar/girar/espelhar, desenhar, texto, borrar), a partir da bandeja de anexos ou de "Editar e enviar" numa imagem da conversa.

**Arquitetura:** estado puro em `ui/image-editor/model.ts` (camadas em coordenadas da imagem original + matriz afim de saída), desenho e exportação em Canvas 2D (`render.ts`), tela cheia em `ImageEditor.tsx`. O resultado é um `File` que entra na bandeja existente; servidor e `/send-media` não mudam.

**Stack:** React 19, TypeScript 6 (type stripping do Node 24), Canvas 2D / OffscreenCanvas, lucide-react, design system em `ui/ds`, testes `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-13-image-editor-design.md`

## Restrições globais

- Sem dependência nova. pnpm 9 (`packageManager`), Node ≥ 24.
- Design system Betinhos: tema claro, **sem gradiente**, só tokens `--bt-*`; o véu reutiliza `rgba(0, 26, 61, .84)` do `.lightbox`; não crie breakpoint, raio, fonte ou sombra de elevação novos.
- Cores de anotação apenas via tokens: `red-700`, `amber-700`, `green-600`, `blue-600`, `navy-900`, `ink-950`, `white`.
- Fechar com alteração → `Dialog` "Descartar alterações?" com "Continuar editando" / "Descartar"; salvando não fecha.
- Formatos editáveis: `image/jpeg`, `image/png`, `image/webp`. Máximo de 8000 px por lado.
- Exportação: PNG continua PNG; o resto vira JPEG, qualidade 0,92, fundo branco; nome `<base>-editada.<ext>`.
- Código no estilo do repo: aspas duplas, `;`, comentários curtos em pt-BR, imports com extensão `.ts`/`.tsx`.
- Commits em português, detalhados, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `ui/image-editor/model.ts` | criar | tipos, matriz, histórico, camadas, recorte, acerto de texto, nome/tipo de exportação (sem DOM) |
| `ui/image-editor/render.ts` | criar | `paint`, `exportEdited`, `loadBitmap`, `measureText`, `textFont`, `tokenColor` |
| `ui/image-editor/ImageEditor.tsx` | criar | tela cheia, gestos de ponteiro, ferramentas, diálogo de descarte |
| `ui/image-editor/image-editor.css` | criar | layout e estilos com tokens |
| `tests/image-editor.test.ts` | criar | testes do modelo |
| `ui/media.tsx` | alterar | `AttachmentTray` ganha `onEdit` e botão de lápis |
| `ui/message-menu.tsx` | alterar | ação `onEditImage` + item "Editar e enviar" |
| `ui/main.tsx` | alterar | estado `editing`, render do editor, substituir anexo, `editImage` |

---

### Tarefa 1: Modelo — geometria, histórico e camadas

**Arquivos:**
- Criar: `ui/image-editor/model.ts`
- Teste: `tests/image-editor.test.ts`

**Interfaces produzidas** (usadas nas tarefas 2–5):
- tipos `Point`, `Rect`, `Rotation`, `Matrix`, `Stroke`, `TextLayer`, `BlurLayer`, `Layer`, `EditState`, `History`
- `MAX_SIDE = 8000`, `MIN_CROP = 16`
- `initialState(width, height): EditState`, `startHistory(s): History`, `commit(h, next): History`, `undo(h)`, `redo(h)`, `isDirty(h): boolean`
- `rotate(s)`, `toggleFlip(s)`, `resetGeometry(s)`, `uncropped(s)`, `setCrop(s, r)`, `clampRect(s, r): Rect`
- `addLayer(s, l)`, `replaceLayer(s, l)`, `removeLayer(s, id)`
- `apply(m, p)`, `invert(m)`, `outputMatrix(s)`, `outputSize(s): { width; height }`, `srcToOut(s, p)`, `outToSrc(s, p)`, `rectFrom(a, b)`, `rectSrcToOut(s, r)`, `rectOutToSrc(s, r)`
- `blurBlock(r): number`, `canEditImage(type)`, `exportType(type)`, `editedName(name, type)`

- [ ] **Passo 1: escrever os testes que falham**

Crie `tests/image-editor.test.ts`:

```ts
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
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `node --test tests/image-editor.test.ts`
Esperado: FAIL com `Cannot find module ... ui/image-editor/model.ts`.

- [ ] **Passo 3: implementar `ui/image-editor/model.ts`**

```ts
/**
 * Editor de imagem: estado puro, sem DOM. Camadas ficam em coordenadas da imagem original;
 * recorte, espelho e giro só mudam a matriz de saída, então nunca reescrevem camadas.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Rotation = 0 | 90 | 180 | 270;
/** Afim no formato do canvas: x' = a·x + c·y + e; y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export type Stroke = { kind: "stroke"; id: number; color: string; width: number; points: Point[] };
/** `at` é o centro do texto. O texto sai sempre na vertical, mesmo com a imagem girada ou espelhada. */
export type TextLayer = { kind: "text"; id: number; color: string; size: number; text: string; at: Point };
export type BlurLayer = { kind: "blur"; id: number; rect: Rect };
export type Layer = Stroke | TextLayer | BlurLayer;

export type EditState = { width: number; height: number; crop: Rect; rotation: Rotation; flip: boolean; layers: Layer[] };
export type History = { past: EditState[]; present: EditState; future: EditState[] };

export const MAX_SIDE = 8000;
export const MIN_CROP = 16;
const HISTORY_LIMIT = 50;
const EDITABLE = ["image/jpeg", "image/png", "image/webp"];

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

// ---- Estado e histórico

export const initialState = (width: number, height: number): EditState => ({
  width, height, crop: { x: 0, y: 0, w: width, h: height }, rotation: 0, flip: false, layers: [],
});

export const startHistory = (s: EditState): History => ({ past: [], present: s, future: [] });

export function commit(h: History, next: EditState): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(h: History): History {
  const prev = h.past.at(-1);
  return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  return next ? { past: [...h.past, h.present], present: next, future: rest } : h;
}

/** Há alteração em relação à imagem aberta (pede "Descartar alterações?" ao fechar). */
export const isDirty = (h: History) => h.past.length > 0;

// ---- Geometria

export const rotate = (s: EditState): EditState => ({ ...s, rotation: ((s.rotation + 90) % 360) as Rotation });
export const toggleFlip = (s: EditState): EditState => ({ ...s, flip: !s.flip });
export const resetGeometry = (s: EditState): EditState => ({ ...s, crop: { x: 0, y: 0, w: s.width, h: s.height }, rotation: 0, flip: false });
/** Mesmo estado sem recorte: é o que a ferramenta Cortar mostra. */
export const uncropped = (s: EditState): EditState => ({ ...s, crop: { x: 0, y: 0, w: s.width, h: s.height } });

export function setCrop(s: EditState, r: Rect): EditState {
  const minW = Math.min(MIN_CROP, s.width);
  const minH = Math.min(MIN_CROP, s.height);
  const x = clamp(Math.round(r.x), 0, s.width - minW);
  const y = clamp(Math.round(r.y), 0, s.height - minH);
  const w = clamp(Math.round(r.w), minW, s.width - x);
  const h = clamp(Math.round(r.h), minH, s.height - y);
  return { ...s, crop: { x, y, w, h } };
}

/** Interseção do retângulo com a imagem (pode zerar). */
export function clampRect(s: EditState, r: Rect): Rect {
  const x = clamp(r.x, 0, s.width);
  const y = clamp(r.y, 0, s.height);
  return { x, y, w: clamp(r.x + r.w, 0, s.width) - x, h: clamp(r.y + r.h, 0, s.height) - y };
}

// ---- Camadas

export const addLayer = (s: EditState, layer: Layer): EditState => ({ ...s, layers: [...s.layers, layer] });
export const replaceLayer = (s: EditState, layer: Layer): EditState => ({ ...s, layers: s.layers.map((l) => (l.id === layer.id ? layer : l)) });
export const removeLayer = (s: EditState, id: number): EditState => ({ ...s, layers: s.layers.filter((l) => l.id !== id) });

// ---- Matriz de saída

const mul = (A: Matrix, B: Matrix): Matrix => [
  A[0] * B[0] + A[2] * B[1],
  A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3],
  A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4],
  A[1] * B[4] + A[3] * B[5] + A[5],
];

export const apply = (m: Matrix, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Imagem original → saída: recorta, espelha (no recorte) e gira no sentido horário. */
export function outputMatrix(s: EditState): Matrix {
  const { x, y, w, h } = s.crop;
  let m: Matrix = [1, 0, 0, 1, -x, -y];
  if (s.flip) m = mul([-1, 0, 0, 1, w, 0], m);
  const turn: Record<Rotation, Matrix> = {
    0: [1, 0, 0, 1, 0, 0],
    90: [0, 1, -1, 0, h, 0],
    180: [-1, 0, 0, -1, w, h],
    270: [0, -1, 1, 0, 0, w],
  };
  return mul(turn[s.rotation], m);
}

export function outputSize(s: EditState): { width: number; height: number } {
  const turned = s.rotation === 90 || s.rotation === 270;
  return turned ? { width: s.crop.h, height: s.crop.w } : { width: s.crop.w, height: s.crop.h };
}

export const srcToOut = (s: EditState, p: Point): Point => apply(outputMatrix(s), p);
export const outToSrc = (s: EditState, p: Point): Point => apply(invert(outputMatrix(s)), p);

export const rectFrom = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
});
/** Giros são múltiplos de 90°, então retângulo continua retângulo alinhado aos eixos. */
export const rectSrcToOut = (s: EditState, r: Rect): Rect => rectFrom(srcToOut(s, r), srcToOut(s, { x: r.x + r.w, y: r.y + r.h }));
export const rectOutToSrc = (s: EditState, r: Rect): Rect => rectFrom(outToSrc(s, r), outToSrc(s, { x: r.x + r.w, y: r.y + r.h }));

// ---- Borrado e exportação

/** Lado do bloco da pixelação: cerca de 10 blocos no lado menor, nunca menos de 6 px. */
export const blurBlock = (r: Rect) => Math.max(6, Math.round(Math.min(r.w, r.h) / 10));

export const canEditImage = (type: string) => EDITABLE.includes(type);
export const exportType = (type: string) => (type === "image/png" ? "image/png" : "image/jpeg");

export function editedName(name: string, type: string): string {
  const base = (name.replace(/\.[^.]+$/, "") || "imagem").replace(/-editada$/, "");
  return `${base}-editada.${exportType(type) === "image/png" ? "png" : "jpg"}`;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `node --test tests/image-editor.test.ts` → esperado: todos PASS.
Rode: `pnpm typecheck` → esperado: sem erros.

- [ ] **Passo 5: commit**

```bash
git add ui/image-editor/model.ts tests/image-editor.test.ts
git commit -m "feat(editor-imagem): modelo puro de geometria, camadas e histórico" -m "Cria ui/image-editor/model.ts com o estado do editor em coordenadas da imagem original, matriz afim de saída (recorte, espelho e giro de 90°) e sua inversa, histórico com desfazer/refazer limitado a 50 passos, operações de camada (traço, texto, borrado) e regras de exportação (tipo e nome do arquivo). Testes cobrem ida e volta da matriz nos 4 giros, limites do recorte e histórico.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: Modelo — gestos de recorte e acerto em texto

**Arquivos:**
- Alterar: `ui/image-editor/model.ts` (adicionar ao final)
- Teste: `tests/image-editor.test.ts` (adicionar ao final)

**Interfaces:**
- Consome: `Rect`, `Point`, `EditState`, `TextLayer`, `srcToOut`, `rectFrom` (Tarefa 1)
- Produz: `type Handle = "move" | "nw" | "ne" | "sw" | "se" | "new"`, `type Bounds = { width: number; height: number }`, `cropHandleAt(r, p, tolerance): Handle`, `dragCrop(start, handle, from, to, bounds, aspect: number | null): Rect`, `aspectCrop(bounds, aspect: number | null): Rect`, `textAt(s, pOut, measure: (l: TextLayer) => Bounds): TextLayer | null`

Todos os gestos trabalham em **coordenadas de saída da vista sem recorte** (`uncropped(s)`), na escala 1:1 da imagem.

- [ ] **Passo 1: escrever os testes que falham**

Acrescente o import (`aspectCrop, cropHandleAt, dragCrop, textAt`) no topo de `tests/image-editor.test.ts` e os testes:

```ts
test("recorte: alça no canto, dentro move, fora cria novo", () => {
  const r = { x: 10, y: 10, w: 100, h: 50 };
  assert.equal(cropHandleAt(r, { x: 12, y: 8 }, 8), "nw");
  assert.equal(cropHandleAt(r, { x: 109, y: 61 }, 8), "se");
  assert.equal(cropHandleAt(r, { x: 108, y: 12 }, 8), "ne");
  assert.equal(cropHandleAt(r, { x: 50, y: 30 }, 8), "move");
  assert.equal(cropHandleAt(r, { x: 200, y: 30 }, 8), "new");
});

test("recorte: mover fica dentro dos limites", () => {
  const b = { width: 200, height: 100 };
  assert.deepEqual(dragCrop({ x: 10, y: 10, w: 100, h: 50 }, "move", { x: 0, y: 0 }, { x: 500, y: -50 }, b, null), { x: 100, y: 0, w: 100, h: 50 });
});

test("recorte: canto redimensiona preso ao canto oposto e trava a proporção", () => {
  const b = { width: 200, height: 100 };
  const r = { x: 10, y: 10, w: 100, h: 50 };
  assert.deepEqual(dragCrop(r, "se", { x: 110, y: 60 }, { x: 150, y: 90 }, b, null), { x: 10, y: 10, w: 140, h: 80 });
  assert.deepEqual(dragCrop(r, "se", { x: 110, y: 60 }, { x: 150, y: 60 }, b, 1), { x: 10, y: 10, w: 90, h: 90 });
  assert.deepEqual(dragCrop(r, "nw", { x: 10, y: 10 }, { x: -20, y: -20 }, b, null), { x: 0, y: 0, w: 110, h: 60 });
  assert.deepEqual(dragCrop(r, "new", { x: 20, y: 20 }, { x: 60, y: 40 }, b, null), { x: 20, y: 20, w: 40, h: 20 });
});

test("recorte: proporção fixa centraliza o maior retângulo possível", () => {
  assert.deepEqual(aspectCrop({ width: 200, height: 100 }, 1), { x: 50, y: 0, w: 100, h: 100 });
  assert.deepEqual(aspectCrop({ width: 200, height: 100 }, 16 / 9), { x: 11, y: 0, w: 178, h: 100 });
  assert.deepEqual(aspectCrop({ width: 200, height: 100 }, null), { x: 0, y: 0, w: 200, h: 100 });
});

test("texto: acerta a camada de cima pelo retângulo medido em volta do centro", () => {
  const a: TextLayer = { kind: "text", id: 1, color: "#000", size: 20, text: "a", at: { x: 50, y: 50 } };
  const b: TextLayer = { ...a, id: 2, at: { x: 60, y: 50 } };
  const s = addLayer(addLayer(initialState(200, 100), a), b);
  const measure = () => ({ width: 40, height: 20 });
  assert.equal(textAt(s, { x: 55, y: 50 }, measure)?.id, 2);
  assert.equal(textAt(s, { x: 35, y: 50 }, measure)?.id, 1);
  assert.equal(textAt(s, { x: 150, y: 50 }, measure), null);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `node --test tests/image-editor.test.ts`
Esperado: FAIL com `does not provide an export named 'aspectCrop'`.

- [ ] **Passo 3: implementar (acrescentar em `model.ts`)**

```ts
// ---- Gestos de recorte (coordenadas de saída da vista sem recorte)

export type Handle = "move" | "nw" | "ne" | "sw" | "se" | "new";
export type Bounds = { width: number; height: number };

export function cropHandleAt(r: Rect, p: Point, tolerance: number): Handle {
  const near = (x: number, y: number) => Math.abs(p.x - x) <= tolerance && Math.abs(p.y - y) <= tolerance;
  if (near(r.x, r.y)) return "nw";
  if (near(r.x + r.w, r.y)) return "ne";
  if (near(r.x, r.y + r.h)) return "sw";
  if (near(r.x + r.w, r.y + r.h)) return "se";
  const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  return inside ? "move" : "new";
}

/** Retângulo do canto fixo `anchor` até `p`, dentro dos limites e, se pedido, na proporção `aspect` (largura/altura). */
function fromCorners(anchor: Point, p: Point, aspect: number | null, b: Bounds): Rect {
  let w = clamp(p.x, 0, b.width) - anchor.x;
  let h = clamp(p.y, 0, b.height) - anchor.y;
  if (aspect) {
    const sx = Math.sign(w) || 1;
    const sy = Math.sign(h) || 1;
    let W = Math.max(Math.abs(w), Math.abs(h) * aspect);
    let H = W / aspect;
    const maxW = sx > 0 ? b.width - anchor.x : anchor.x;
    const maxH = sy > 0 ? b.height - anchor.y : anchor.y;
    if (W > maxW) { W = maxW; H = W / aspect; }
    if (H > maxH) { H = maxH; W = H * aspect; }
    w = sx * W;
    h = sy * H;
  }
  return rectFrom(anchor, { x: anchor.x + w, y: anchor.y + h });
}

export function dragCrop(start: Rect, handle: Handle, from: Point, to: Point, b: Bounds, aspect: number | null): Rect {
  if (handle === "move") {
    return {
      x: clamp(start.x + to.x - from.x, 0, b.width - start.w),
      y: clamp(start.y + to.y - from.y, 0, b.height - start.h),
      w: start.w,
      h: start.h,
    };
  }
  if (handle === "new") return fromCorners(from, to, aspect, b);
  const anchor = {
    nw: { x: start.x + start.w, y: start.y + start.h },
    ne: { x: start.x, y: start.y + start.h },
    sw: { x: start.x + start.w, y: start.y },
    se: { x: start.x, y: start.y },
  }[handle];
  return fromCorners(anchor, to, aspect, b);
}

/** Maior retângulo centralizado na proporção pedida; sem proporção, a imagem toda. */
export function aspectCrop(b: Bounds, aspect: number | null): Rect {
  if (!aspect) return { x: 0, y: 0, w: b.width, h: b.height };
  const w = Math.round(b.width / b.height > aspect ? b.height * aspect : b.width);
  const h = Math.round(b.width / b.height > aspect ? b.height : b.width / aspect);
  return { x: Math.round((b.width - w) / 2), y: Math.round((b.height - h) / 2), w, h };
}

// ---- Texto

/** Texto de cima que contém `pOut` (coordenadas de saída). `measure` devolve largura e altura em px da imagem. */
export function textAt(s: EditState, pOut: Point, measure: (l: TextLayer) => Bounds): TextLayer | null {
  for (let i = s.layers.length - 1; i >= 0; i--) {
    const l = s.layers[i];
    if (l.kind !== "text") continue;
    const c = srcToOut(s, l.at);
    const { width, height } = measure(l);
    if (Math.abs(pOut.x - c.x) <= width / 2 && Math.abs(pOut.y - c.y) <= height / 2) return l;
  }
  return null;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `node --test tests/image-editor.test.ts` e `pnpm typecheck` → esperado: PASS, sem erros.

- [ ] **Passo 5: commit**

```bash
git add ui/image-editor/model.ts tests/image-editor.test.ts
git commit -m "feat(editor-imagem): gestos de recorte e acerto em texto" -m "Acrescenta ao modelo a detecção de alça do recorte (cantos, mover, novo), o arrasto com limites e proporção travada, o recorte centralizado por proporção (Livre, 1:1, 4:3, 16:9) e a busca do texto sob o ponteiro, todos em coordenadas de saída e cobertos por testes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3: Renderização e exportação no canvas

**Arquivos:**
- Criar: `ui/image-editor/render.ts`

**Interfaces:**
- Consome: `apply`, `blurBlock`, `editedName`, `exportType`, `MAX_SIDE`, `outputMatrix`, `outputSize`, `EditState`, `Layer`, `Rect`, `Stroke`, `TextLayer`, `Point`, `Matrix` (Tarefa 1)
- Produz:
  - `tokenColor(name: string): string`: lê `--bt-color-<name>`
  - `textFont(size: number): string`
  - `measureText(l: TextLayer): { width: number; height: number }`
  - `paint(ctx, img, s, scale, extra?: Layer, background?: string): void`: `extra` substitui a camada de mesmo id (arrasto de texto) ou entra no fim
  - `loadBitmap(blob): Promise<ImageBitmap>`: lança `Error` com mensagem em pt-BR
  - `exportEdited(img, s, file): Promise<File>`

Não há canvas no Node; a verificação desta tarefa é typecheck + uso real na Tarefa 4.

- [ ] **Passo 1: implementar `ui/image-editor/render.ts`**

```ts
import { apply, blurBlock, editedName, exportType, MAX_SIDE, outputMatrix, outputSize, type EditState, type Layer, type Matrix, type Point, type Rect, type Stroke, type TextLayer } from "./model.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Cor de token do design system (anotações nunca usam hexadecimal solto). */
export const tokenColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--bt-color-${name}`).trim();

export const textFont = (size: number) => `800 ${size}px "Manrope Variable", sans-serif`;
const LINE = 1.2;

let measurer: OffscreenCanvasRenderingContext2D | null = null;
/** Caixa do texto em px da imagem (para acertar o clique e arrastar). */
export function measureText(l: TextLayer): { width: number; height: number } {
  measurer ??= new OffscreenCanvas(1, 1).getContext("2d")!;
  measurer.font = textFont(l.size);
  const lines = l.text.split("\n");
  return { width: Math.max(...lines.map((t) => measurer!.measureText(t).width)), height: lines.length * l.size * LINE };
}

function pixelate(ctx: Ctx, img: CanvasImageSource, r: Rect) {
  const block = blurBlock(r);
  const w = Math.max(1, Math.ceil(r.w / block));
  const h = Math.max(1, Math.ceil(r.h / block));
  const small = new OffscreenCanvas(w, h);
  small.getContext("2d")!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, w, h, r.x, r.y, r.w, r.h);
  ctx.restore();
}

function stroke(ctx: Ctx, l: Stroke) {
  const [first, ...rest] = l.points;
  if (!first) return;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = l.color;
  ctx.lineWidth = l.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (rest.length) {
    ctx.moveTo(first.x, first.y);
    for (const p of rest) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  } else {
    ctx.arc(first.x, first.y, l.width / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Texto na vertical, centrado em `at` (saída), com contorno para ler sobre qualquer foto. */
function text(ctx: Ctx, l: TextLayer, at: Point) {
  const white = tokenColor("white");
  ctx.font = textFont(l.size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, l.size / 8);
  ctx.strokeStyle = l.color === white ? tokenColor("ink-950") : white;
  ctx.fillStyle = l.color;
  const lines = l.text.split("\n");
  const top = at.y - ((lines.length - 1) * l.size * LINE) / 2;
  lines.forEach((t, i) => {
    ctx.strokeText(t, at.x, top + i * l.size * LINE);
    ctx.fillText(t, at.x, top + i * l.size * LINE);
  });
}

/** Desenha a imagem editada; `scale` 1 = tamanho final. `extra` é a camada em andamento. */
export function paint(ctx: Ctx, img: CanvasImageSource, s: EditState, scale: number, extra?: Layer, background?: string) {
  const size = outputSize(s);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  if (ctx.canvas.width !== width) ctx.canvas.width = width;
  if (ctx.canvas.height !== height) ctx.canvas.height = height;
  const m = outputMatrix(s);
  const view: Matrix = [m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.setTransform(...view);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0);
  const layers = extra ? [...s.layers.filter((l) => l.id !== extra.id), extra] : s.layers;
  for (const l of layers) {
    if (l.kind === "blur") pixelate(ctx, img, l.rect);
    else if (l.kind === "stroke") stroke(ctx, l);
    else {
      ctx.save();
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      text(ctx, l, apply(m, l.at));
      ctx.restore();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Abre a imagem respeitando a orientação EXIF. */
export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("Não foi possível abrir esta imagem para edição.");
  }
  if (Math.max(bitmap.width, bitmap.height) > MAX_SIDE) {
    bitmap.close();
    throw new Error(`Imagem grande demais para editar (máximo de ${MAX_SIDE} px por lado).`);
  }
  return bitmap;
}

export async function exportEdited(img: ImageBitmap, s: EditState, file: File): Promise<File> {
  const size = outputSize(s);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const type = exportType(file.type);
  paint(canvas.getContext("2d")!, img, s, 1, undefined, type === "image/jpeg" ? tokenColor("white") : undefined);
  const blob = await canvas.convertToBlob(type === "image/jpeg" ? { type, quality: 0.92 } : { type });
  return new File([blob], editedName(file.name, file.type), { type });
}
```

- [ ] **Passo 2: conferir tipos**

Rode: `pnpm typecheck` → esperado: sem erros. Se `ctx.setTransform(...view)` reclamar da tupla `readonly`, use `ctx.setTransform(view[0], view[1], view[2], view[3], view[4], view[5])`.

- [ ] **Passo 3: commit**

```bash
git add ui/image-editor/render.ts
git commit -m "feat(editor-imagem): renderização e exportação em canvas" -m "Cria ui/image-editor/render.ts: desenha imagem, traços, textos (sempre na vertical, com contorno de token) e áreas pixeladas usando a matriz do modelo; abre a imagem com createImageBitmap (orientação EXIF, limite de 8000 px) e exporta um File novo (PNG continua PNG, demais viram JPEG 0,92 com fundo branco). Cores de anotação lidas dos tokens --bt-color-*.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4: Tela do editor (`ImageEditor`)

**Arquivos:**
- Criar: `ui/image-editor/ImageEditor.tsx`
- Criar: `ui/image-editor/image-editor.css`

**Interfaces:**
- Consome: Tarefas 1–3; `Button`, `Dialog`, `SegmentedControl` de `../ds/index.ts`
- Produz: `export function ImageEditor(props: { file: File; onDone: (file: File) => void; onClose: () => void })`. Com sucesso, chama `onDone(arquivoEditado)`; quem usa é quem fecha. Sem alteração, "Concluir" chama `onClose()`.

- [ ] **Passo 1: criar `ui/image-editor/image-editor.css`**

```css
/* Editor de imagem: tela cheia sobre o mesmo véu navy do lightbox; barras em superfície clara. */
.image-editor { position: fixed; inset: 0; z-index: var(--bt-z-index-drawer); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-areas: "bar" "stage" "tools"; background-color: rgba(0, 26, 61, .84); animation: fade var(--bt-duration-normal) var(--bt-ease-out); }
.image-editor__bar { grid-area: bar; display: flex; align-items: center; gap: var(--bt-space-2); padding: var(--bt-space-2) var(--bt-space-3); background-color: var(--bt-color-surface); border-bottom: var(--bt-border-width-default) solid var(--bt-color-border); }
.image-editor__title { flex: 1; min-width: 0; font-weight: var(--bt-font-weight-extrabold); color: var(--bt-color-text-primary); }
.image-editor__stage { grid-area: stage; display: grid; place-items: center; padding: var(--bt-space-4); overflow: hidden; }
.image-editor__canvas { position: relative; overflow: hidden; touch-action: none; user-select: none; border-radius: var(--bt-radius-md); }
.image-editor__canvas canvas { display: block; width: 100%; height: 100%; }
.image-editor__canvas--draw, .image-editor__canvas--blur, .image-editor__canvas--crop { cursor: crosshair; }
.image-editor__canvas--text { cursor: text; }
/* Escurece fora do recorte com o mesmo véu; não é sombra de elevação. */
.image-editor__crop { position: absolute; pointer-events: none; outline: 2px solid var(--bt-color-surface); box-shadow: 0 0 0 9999px rgba(0, 26, 61, .84); }
.image-editor__handle { position: absolute; width: 14px; height: 14px; border-radius: var(--bt-radius-full); background-color: var(--bt-color-surface); border: 2px solid var(--bt-color-action); }
.image-editor__handle--nw { left: -7px; top: -7px; }
.image-editor__handle--ne { right: -7px; top: -7px; }
.image-editor__handle--sw { left: -7px; bottom: -7px; }
.image-editor__handle--se { right: -7px; bottom: -7px; }
.image-editor__text { position: absolute; transform: translate(-50%, -50%); field-sizing: content; min-width: 2ch; max-width: 90%; margin: 0; padding: 0 var(--bt-space-1); border: 0; outline: 1px dashed var(--bt-color-surface); background-color: transparent; text-align: center; line-height: 1.2; resize: none; overflow: hidden; }
.image-editor__tools { grid-area: tools; display: flex; flex-direction: column; align-items: center; gap: var(--bt-space-2); padding: var(--bt-space-3); background-color: var(--bt-color-surface); border-top: var(--bt-border-width-default) solid var(--bt-color-border); }
.image-editor__tools > * { width: 100%; max-width: 560px; }
.image-editor__options { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--bt-space-2); min-height: 32px; }
.image-editor__inks { display: flex; gap: var(--bt-space-1-5); }
.image-editor__ink { width: 32px; height: 32px; padding: 0; border-radius: var(--bt-radius-full); border: var(--bt-border-width-default) solid var(--bt-color-border); cursor: pointer; }
.image-editor__ink[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--bt-color-surface), 0 0 0 4px var(--bt-color-action); }
@media (prefers-reduced-motion: reduce) { .image-editor { animation: none; } }
```

- [ ] **Passo 2: criar `ui/image-editor/ImageEditor.tsx`**

```tsx
import { Check, Crop, EyeOff, FlipHorizontal2, LoaderCircle, Pencil, Redo2, RotateCw, TriangleAlert, Type, Undo2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Dialog, SegmentedControl } from "../ds/index.ts";
import {
  addLayer, aspectCrop, clampRect, commit, cropHandleAt, dragCrop, isDirty, outputSize, outToSrc, rectFrom, rectOutToSrc, rectSrcToOut,
  redo, removeLayer, replaceLayer, resetGeometry, rotate, setCrop, srcToOut, startHistory, textAt, toggleFlip, uncropped, undo,
  initialState, type EditState, type Handle, type History, type Layer, type Point, type Rect, type TextLayer,
} from "./model.ts";
import { exportEdited, loadBitmap, measureText, paint, textFont, tokenColor } from "./render.ts";
import "./image-editor.css";

type Tool = "crop" | "draw" | "text" | "blur";
type Size = "s" | "m" | "l";
type AspectKey = "free" | "1:1" | "4:3" | "16:9";
const ASPECTS: Record<AspectKey, number | null> = { free: null, "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9 };
const INKS = ["red-700", "amber-700", "green-600", "blue-600", "navy-900", "ink-950", "white"] as const;
type Ink = (typeof INKS)[number];
const INK_LABEL: Record<Ink, string> = {
  "red-700": "Vermelho", "amber-700": "Amarelo", "green-600": "Verde", "blue-600": "Azul", "navy-900": "Azul-marinho", "ink-950": "Preto", white: "Branco",
};
/** Em px de tela; viram px da imagem dividindo pela escala da vista. */
const STROKE: Record<Size, number> = { s: 3, m: 6, l: 12 };
const TEXT: Record<Size, number> = { s: 20, m: 30, l: 44 };

type Typing = { id: number | null; at: Point; value: string; color: string; size: number };
type Gesture =
  | { kind: "draw"; draft: Layer }
  | { kind: "blur"; from: Point; draft: Layer | null }
  | { kind: "crop"; handle: Handle; from: Point; start: Rect; rect: Rect | null }
  | { kind: "text"; layer: TextLayer; from: Point; draft: Layer | null };

let lastLayerId = 0;
const nextLayerId = () => ++lastLayerId;

/** Editor de imagem em tela cheia: cortar/girar, desenhar, texto e borrar. Devolve um File novo em `onDone`. */
export function ImageEditor({ file, onDone, onClose }: { file: File; onDone: (file: File) => void; onClose: () => void }) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [tool, setTool] = useState<Tool>("draw");
  const [ink, setInk] = useState<Ink>("red-700");
  const [size, setSize] = useState<Size>("m");
  const [aspect, setAspect] = useState<AspectKey>("free");
  const [draft, setDraft] = useState<Layer | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const typingRef = useRef(typing);
  typingRef.current = typing;

  useEffect(() => {
    let alive = true;
    let opened: ImageBitmap | null = null;
    loadBitmap(file).then(
      (b) => {
        if (!alive) return b.close();
        opened = b;
        setBitmap(b);
        setHist(startHistory(initialState(b.width, b.height)));
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
      opened?.close();
    };
  }, [file]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => opener?.focus();
  }, []);

  const s = hist?.present ?? null;
  const view = useMemo(() => (s && tool === "crop" ? uncropped(s) : s), [s, tool]);
  // O texto em edição sai do canvas enquanto o campo está aberto.
  const painted = useMemo(
    () => (view && typing?.id != null ? { ...view, layers: view.layers.filter((l) => l.id !== typing.id) } : view),
    [view, typing?.id],
  );
  const out = view ? outputSize(view) : { width: 1, height: 1 };
  const scale = box.width && box.height ? Math.min(box.width / out.width, box.height / out.height, 4) : 0;
  const handlePx = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 24 : 14;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap || !painted || !scale) return;
    paint(c.getContext("2d")!, bitmap, painted, scale * (window.devicePixelRatio || 1), draft ?? undefined);
  }, [bitmap, painted, scale, draft]);

  const dirty = hist ? isDirty(hist) : false;
  const change = (next: (st: EditState) => EditState) => setHist((h) => (h ? commit(h, next(h.present)) : h));
  const tryClose = () => {
    if (saving) return;
    if (dirty) setAsking(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (asking) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (typingRef.current) {
          typingRef.current = null;
          setTyping(null);
        } else tryClose();
        return;
      }
      if (typingRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        setHist((h) => h && (e.shiftKey ? redo(h) : undo(h)));
      } else if (mod && key === "y") {
        e.preventDefault();
        setHist((h) => h && redo(h));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const finishTyping = () => {
    const t = typingRef.current;
    if (!t) return;
    typingRef.current = null;
    setTyping(null);
    const text = t.value.trim();
    const id = t.id;
    if (id == null) {
      if (text) change((st) => addLayer(st, { kind: "text", id: nextLayerId(), color: t.color, size: t.size, text, at: t.at }));
      return;
    }
    if (!text) return change((st) => removeLayer(st, id));
    const old = s?.layers.find((l) => l.id === id);
    if (old?.kind === "text" && old.text === text && old.color === t.color) return;
    change((st) => replaceLayer(st, { kind: "text", id, color: t.color, size: t.size, text, at: t.at }));
  };

  const pointOut = (e: ReactPointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Com texto aberto, o clique só tira o foco do campo (o blur confirma o texto).
    if (!view || !s || saving || e.button !== 0 || typingRef.current) return;
    const p = pointOut(e);
    const src = outToSrc(view, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "draw") {
      const first: Layer = { kind: "stroke", id: nextLayerId(), color: tokenColor(ink), width: STROKE[size] / scale, points: [src] };
      gesture.current = { kind: "draw", draft: first };
      setDraft(first);
    } else if (tool === "blur") {
      gesture.current = { kind: "blur", from: src, draft: null };
    } else if (tool === "crop") {
      const rect = rectSrcToOut(view, s.crop);
      gesture.current = { kind: "crop", handle: cropHandleAt(rect, p, handlePx / scale), from: p, start: rect, rect: null };
    } else {
      const hit = textAt(view, p, measureText);
      if (hit) gesture.current = { kind: "text", layer: hit, from: src, draft: null };
      else setTyping({ id: null, at: src, value: "", color: tokenColor(ink), size: TEXT[size] / scale });
    }
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !view) return;
    const p = pointOut(e);
    const src = outToSrc(view, p);
    if (g.kind === "draw" && g.draft.kind === "stroke") {
      const last = g.draft.points.at(-1)!;
      if (Math.hypot(src.x - last.x, src.y - last.y) * scale < 1.5) return;
      g.draft = { ...g.draft, points: [...g.draft.points, src] };
      setDraft(g.draft);
    } else if (g.kind === "blur") {
      g.draft = { kind: "blur", id: 0, rect: rectFrom(g.from, src) };
      setDraft(g.draft);
    } else if (g.kind === "crop") {
      g.rect = dragCrop(g.start, g.handle, g.from, p, outputSize(view), ASPECTS[aspect]);
      setCropDraft(g.rect);
    } else if (g.kind === "text") {
      g.draft = { ...g.layer, at: { x: g.layer.at.x + src.x - g.from.x, y: g.layer.at.y + src.y - g.from.y } };
      setDraft(g.draft);
    }
  };

  const up = () => {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    setCropDraft(null);
    if (!g || !view || !s) return;
    if (g.kind === "draw") change((st) => addLayer(st, g.draft));
    else if (g.kind === "blur" && g.draft?.kind === "blur") {
      const rect = clampRect(s, g.draft.rect);
      if (rect.w * scale >= 6 && rect.h * scale >= 6) change((st) => addLayer(st, { kind: "blur", id: nextLayerId(), rect }));
    } else if (g.kind === "crop" && g.rect && g.rect.w * scale >= 12 && g.rect.h * scale >= 12) {
      const rect = g.rect;
      change((st) => setCrop(st, rectOutToSrc(view, rect)));
    } else if (g.kind === "text") {
      if (g.draft) {
        const moved = g.draft;
        change((st) => replaceLayer(st, moved));
      } else setTyping({ id: g.layer.id, at: g.layer.at, value: g.layer.text, color: g.layer.color, size: g.layer.size });
    }
  };

  const pickTool = (next: Tool) => {
    finishTyping();
    setTool(next);
  };
  const pickInk = (next: Ink) => {
    setInk(next);
    if (typingRef.current) setTyping({ ...typingRef.current, color: tokenColor(next) });
  };
  const pickAspect = (key: AspectKey) => {
    setAspect(key);
    const ratio = ASPECTS[key];
    if (ratio) change((st) => setCrop(st, rectOutToSrc(uncropped(st), aspectCrop(outputSize(uncropped(st)), ratio))));
  };

  const done = async () => {
    if (!bitmap || !hist || saving) return;
    if (!isDirty(hist)) return onClose();
    setSaving(true);
    setError(null);
    try {
      onDone(await exportEdited(bitmap, hist.present, file));
    } catch {
      setError("Não foi possível salvar a edição. Tente de novo.");
      setSaving(false);
    }
  };

  const cropRect = tool === "crop" && view && s ? cropDraft ?? rectSrcToOut(view, s.crop) : null;
  const typingAt = typing && view ? srcToOut(view, typing.at) : null;
  const sizeLabels = tool === "text" ? ["Pequeno", "Médio", "Grande"] : ["Fina", "Média", "Grossa"];

  return (
    <div ref={root} className="image-editor" role="dialog" aria-modal="true" aria-label="Editar imagem">
      <header className="image-editor__bar">
        <Button variant="ghost" icon={<X size={18} aria-hidden />} aria-label="Fechar editor" disabled={saving} onClick={tryClose} />
        <span className="image-editor__title">Editar imagem</span>
        <Button variant="ghost" icon={<Undo2 size={18} aria-hidden />} aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!hist?.past.length || saving} onClick={() => setHist((h) => h && undo(h))} />
        <Button variant="ghost" icon={<Redo2 size={18} aria-hidden />} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" disabled={!hist?.future.length || saving} onClick={() => setHist((h) => h && redo(h))} />
        <Button variant="primary" icon={<Check size={16} aria-hidden />} loading={saving} disabled={!bitmap} onClick={() => void done()}>
          Concluir
        </Button>
      </header>

      <div ref={stage} className="image-editor__stage" onClick={(e) => e.target === e.currentTarget && tryClose()}>
        {error && (
          <p className="viewer__error viewer__error--dark" role="alert">
            <TriangleAlert size={14} aria-hidden /> {error}
          </p>
        )}
        {!bitmap && !error && <LoaderCircle className="spin" size={28} aria-label="Abrindo imagem" />}
        {bitmap && view && scale > 0 && (
          <div
            className={`image-editor__canvas image-editor__canvas--${tool}`}
            style={{ width: out.width * scale, height: out.height * scale }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <canvas ref={canvas} />
            {cropRect && (
              <div className="image-editor__crop" style={{ left: cropRect.x * scale, top: cropRect.y * scale, width: cropRect.w * scale, height: cropRect.h * scale }} aria-hidden>
                {(["nw", "ne", "sw", "se"] as const).map((h) => <span key={h} className={`image-editor__handle image-editor__handle--${h}`} />)}
              </div>
            )}
            {typing && typingAt && (
              <textarea
                className="image-editor__text"
                autoFocus
                rows={1}
                aria-label="Texto sobre a imagem"
                value={typing.value}
                style={{ left: typingAt.x * scale, top: typingAt.y * scale, font: textFont(typing.size * scale), color: typing.color }}
                onChange={(e) => setTyping({ ...typing, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                onBlur={finishTyping}
                onPointerDown={(e) => e.stopPropagation()}
              />
            )}
          </div>
        )}
      </div>

      <footer className="image-editor__tools">
        <SegmentedControl<Tool>
          aria-label="Ferramenta"
          fullWidth
          value={tool}
          onChange={pickTool}
          options={[
            { value: "crop", label: <><Crop size={16} aria-hidden /> Cortar</> },
            { value: "draw", label: <><Pencil size={16} aria-hidden /> Desenhar</> },
            { value: "text", label: <><Type size={16} aria-hidden /> Texto</> },
            { value: "blur", label: <><EyeOff size={16} aria-hidden /> Borrar</> },
          ]}
        />
        <div className="image-editor__options">
          {tool === "crop" ? (
            <>
              <SegmentedControl<AspectKey>
                aria-label="Proporção"
                size="compact"
                value={aspect}
                onChange={pickAspect}
                options={[{ value: "free", label: "Livre" }, { value: "1:1", label: "1:1" }, { value: "4:3", label: "4:3" }, { value: "16:9", label: "16:9" }]}
              />
              <Button variant="secondary" size="compact" icon={<RotateCw size={16} aria-hidden />} disabled={!s} onClick={() => change(rotate)}>
                Girar
              </Button>
              <Button variant="secondary" size="compact" icon={<FlipHorizontal2 size={16} aria-hidden />} disabled={!s} onClick={() => change(toggleFlip)}>
                Espelhar
              </Button>
              <Button variant="ghost" size="compact" disabled={!s} onClick={() => { setAspect("free"); change(resetGeometry); }}>
                Restaurar
              </Button>
            </>
          ) : tool === "blur" ? (
            <p className="hint">Arraste sobre a área que deve ficar ilegível.</p>
          ) : (
            <>
              <div className="image-editor__inks" role="group" aria-label="Cor">
                {INKS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="image-editor__ink"
                    aria-label={INK_LABEL[name]}
                    aria-pressed={ink === name}
                    style={{ backgroundColor: `var(--bt-color-${name})` }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickInk(name)}
                  />
                ))}
              </div>
              <SegmentedControl<Size>
                aria-label={tool === "text" ? "Tamanho do texto" : "Espessura"}
                size="compact"
                value={size}
                onChange={setSize}
                options={[{ value: "s", label: sizeLabels[0] }, { value: "m", label: sizeLabels[1] }, { value: "l", label: sizeLabels[2] }]}
              />
            </>
          )}
        </div>
      </footer>

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Descartar alterações?"
        tone="danger"
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Continuar editando
            </Button>
            <Button variant="danger" onClick={onClose}>
              Descartar
            </Button>
          </>
        }
      >
        As edições desta imagem serão perdidas.
      </Dialog>
    </div>
  );
}
```

- [ ] **Passo 3: conferir tipos e build**

Rode: `pnpm typecheck` e `pnpm build` → esperado: sem erros; o bundle inclui `image-editor.css`.
Se o `SegmentedControl` não aceitar o genérico explícito (`<Tool>`), remova-o; o tipo é inferido pelo `value`.

- [ ] **Passo 4: commit**

```bash
git add ui/image-editor/ImageEditor.tsx ui/image-editor/image-editor.css
git commit -m "feat(editor-imagem): tela cheia com cortar, desenhar, texto e borrar" -m "Cria o componente ImageEditor: palco com canvas ajustado ao espaço disponível, gestos por pointer events (mouse, toque e caneta), recorte com alças e proporções, giro e espelho, caneta e texto com 7 cores de token e 3 tamanhos, pixelação de áreas, desfazer/refazer por botão e Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, e fechamento por X, Esc ou clique no véu com confirmação 'Descartar alterações?' quando há edição. Estilos usam apenas tokens do design system e o véu navy do lightbox.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 5: Entrada pela bandeja de anexos

**Arquivos:**
- Alterar: `ui/media.tsx` (`AttachmentTray`, por volta da linha 670; import do lucide na linha 1)
- Alterar: `ui/main.tsx` (`ChatView`: estado dos anexos por volta da linha 1056, efeito de troca de chat por volta da 1074, bandeja por volta da 2192, diálogos por volta da 2124)

**Interfaces:**
- Consome: `ImageEditor` (Tarefa 4), `canEditImage` (Tarefa 1), `toAttachment` e `Attachment` (existentes)
- Produz: `AttachmentTray` com a prop obrigatória `onEdit: (a: Attachment) => void`; estado `editing` em `ChatView`, reutilizado na Tarefa 6

- [ ] **Passo 1: botão de lápis na bandeja (`ui/media.tsx`)**

Acrescente `Pencil` ao import do `lucide-react` e `import { canEditImage } from "./image-editor/model.ts";`. Troque a assinatura e inclua o botão antes do botão de remover:

```tsx
export function AttachmentTray({ items, onRemove, onEdit, disabled }: { items: Attachment[]; onRemove: (id: number) => void; onEdit: (a: Attachment) => void; disabled: boolean }) {
```

```tsx
          {a.preview && !a.voice && canEditImage(a.file.type) && (
            <Button variant="ghost" size="compact" icon={<Pencil size={14} aria-hidden />} aria-label={`Editar ${a.file.name}`} title="Editar imagem" disabled={disabled} onClick={() => onEdit(a)} />
          )}
          <Button variant="ghost" size="compact" icon={<X size={14} aria-hidden />} aria-label={`Remover ${a.file.name}`} disabled={disabled} onClick={() => onRemove(a.id)} />
```

- [ ] **Passo 2: estado e editor no `ChatView` (`ui/main.tsx`)**

Imports no topo: `import { ImageEditor } from "./image-editor/ImageEditor.tsx";`

Logo após `const [attachments, setAttachments] = useState<Attachment[]>([]);`:

```tsx
  // Imagem aberta no editor: da bandeja (substitui o anexo) ou de uma mensagem (entra na bandeja).
  const [editing, setEditing] = useState<{ file: File; attachmentId: number | null } | null>(null);
```

Logo após `removeAttachment`:

```tsx
  const replaceAttachment = (id: number, file: File) =>
    setAttachments((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        if (a.preview) URL.revokeObjectURL(a.preview);
        return toAttachment(file);
      }),
    );
```

No efeito que limpa anexos ao trocar de conversa (o que chama `recorder.cancel()`), acrescente `setEditing(null);`.

Na bandeja:

```tsx
        {attachments.length > 0 && <AttachmentTray items={attachments} onRemove={removeAttachment} onEdit={(a) => setEditing({ file: a.file, attachmentId: a.id })} disabled={sending} />}
```

Antes de `{forwarding && (`:

```tsx
      {editing && (
        <ImageEditor
          file={editing.file}
          onClose={() => setEditing(null)}
          onDone={(file) => {
            if (editing.attachmentId != null) replaceAttachment(editing.attachmentId, file);
            else addFiles([file]);
            setEditing(null);
          }}
        />
      )}
```

- [ ] **Passo 3: conferir**

Rode: `pnpm typecheck`, `pnpm test` e `pnpm build` → esperado: sem erros e todos os testes PASS.

- [ ] **Passo 4: commit**

```bash
git add ui/media.tsx ui/main.tsx
git commit -m "feat(editor-imagem): editar imagem pela bandeja de anexos" -m "Adiciona um botão de lápis às imagens JPEG/PNG/WEBP da bandeja de anexos (não aparece em áudio, documento, GIF ou figurinha). O editor abre em tela cheia e, ao concluir, a imagem editada substitui o anexo original, liberando a URL de prévia antiga. Trocar de conversa fecha o editor. O envio segue pelo fluxo existente de send-media.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 6: "Editar e enviar" a partir de uma imagem da conversa

**Arquivos:**
- Alterar: `ui/message-menu.tsx` (tipo `MessageMenuActions` na linha 10; itens por volta da linha 79; import do lucide)
- Alterar: `ui/main.tsx` (callback perto de `copyFile`, por volta da linha 1602; objeto `actions` na linha 2120)

**Interfaces:**
- Consome: `editing`/`setEditing` (Tarefa 5), `canEditImage` (Tarefa 1), `mediaUrl` e `notify` (existentes)
- Produz: `MessageMenuActions.onEditImage: (m: Message) => void`

- [ ] **Passo 1: ação e item no menu (`ui/message-menu.tsx`)**

Em `MessageMenuActions`, depois de `onView`:

```ts
  /** Abre a imagem no editor; o resultado entra na bandeja de anexos desta conversa. */
  onEditImage: (m: Message) => void;
```

Acrescente `Brush` ao import do `lucide-react` e, logo depois do item `view`:

```tsx
        ...(m.media?.type === "image" ? [{ id: "edit-image", label: "Editar e enviar", icon: <Brush size={16} aria-hidden />, disabled: !canAct, run: () => actions.onEditImage(m) }] : []),
```

- [ ] **Passo 2: callback no `ChatView` (`ui/main.tsx`)**

Acrescente `canEditImage` ao import (`import { canEditImage } from "./image-editor/model.ts";`). Perto de `copyFile`:

```tsx
  const editImage = useCallback(
    async (m: Message) => {
      try {
        const res = await fetch(mediaUrl(m));
        if (!res.ok) throw new Error("Não foi possível abrir a imagem. Ela pode ter expirado no WhatsApp.");
        const blob = await res.blob();
        const type = blob.type || m.media?.mimetype || "";
        if (!canEditImage(type)) throw new Error("Este formato de imagem não pode ser editado.");
        const name = m.media?.fileName || `imagem-${m.id}.${type === "image/png" ? "png" : "jpg"}`;
        setEditing({ file: new File([blob], name, { type }), attachmentId: null });
      } catch (e) {
        notify("error", e instanceof Error ? e.message : String(e));
      }
    },
    [notify],
  );
```

No objeto `actions={{ ... }}` do `MessageMenu`, acrescente `onEditImage: (m) => void editImage(m),`.

- [ ] **Passo 3: conferir**

Rode: `pnpm typecheck`, `pnpm test` e `pnpm build` → esperado: sem erros.

- [ ] **Passo 4: commit**

```bash
git add ui/message-menu.tsx ui/main.tsx
git commit -m "feat(editor-imagem): 'Editar e enviar' no menu de imagens da conversa" -m "Adiciona ao menu de contexto das mensagens de imagem a ação 'Editar e enviar': baixa a mídia pela rota existente, confere se o formato é editável e abre o editor; ao concluir, a imagem editada entra na bandeja de anexos da conversa atual para envio com legenda. Falhas de download ou formato aparecem como toast de erro. A ação fica desabilitada com o WhatsApp desconectado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 7: Verificação no app

**Arquivos:** nenhum (só ajustes se algo falhar, em commit próprio)

- [ ] **Passo 1: gate automático**

Rode: `pnpm typecheck`, `pnpm test` e `pnpm build` → esperado: tudo verde. Anote a saída resumida.

- [ ] **Passo 2: teste manual com `pnpm dev`** (desktop e janela estreita de ~400 px)

1. Anexar uma foto JPEG retrato de celular (com EXIF) → lápis → a imagem abre na orientação correta.
2. Desenhar, escrever texto (Enter confirma; clicar no texto edita; arrastar move), borrar uma placa → Desfazer/Refazer pelos botões e pelo Ctrl+Z / Ctrl+Shift+Z.
3. Cortar: Livre arrastando cantos, 1:1, 16:9, Girar 2×, Espelhar e Restaurar; o texto continua na vertical.
4. Concluir → miniatura atualizada com nome `*-editada.jpg` → enviar com legenda → conferir no celular que a imagem chegou editada e que a área borrada está ilegível.
5. Esc com alteração → "Descartar alterações?" → "Continuar editando" mantém a edição; "Descartar" fecha e preserva o anexo original.
6. Clique no véu fora da imagem → mesmo comportamento do Esc.
7. Menu de uma imagem recebida → "Editar e enviar" → concluir → a imagem entra na bandeja.
8. PNG com transparência continua PNG; GIF não mostra o lápis.
9. Teclado: Tab percorre as barras com foco visível; setas trocam a ferramenta.

- [ ] **Passo 3: registrar e encerrar**

Corrija o que falhar (um commit por correção, mensagem em português). Ao final, `git status` limpo e use superpowers:finishing-a-development-branch para PR e merge.

---

## Autorrevisão (feita)

- **Cobertura da spec:** ferramentas → T1/T2/T3/T4; entradas → T5/T6; erros (formato, tamanho, download, exportação, sem alteração) → T3/T4/T6; design system (tokens, véu, Dialog, sem gradiente) → T4; testes → T1/T2/T7.
- **Placeholders:** nenhum; todo passo de código traz o código.
- **Consistência de nomes:** `canEditImage`, `editedName`, `exportType`, `uncropped`, `rectSrcToOut`/`rectOutToSrc`, `textAt`, `measureText`, `paint(ctx, img, s, scale, extra?, background?)`, `exportEdited(img, s, file)`, `onEditImage` e `editing` são usados com a mesma assinatura em todas as tarefas.
