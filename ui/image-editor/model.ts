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
