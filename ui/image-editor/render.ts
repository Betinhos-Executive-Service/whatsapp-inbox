import { apply, blurBlock, editedName, exportType, MAX_SIDE, outputMatrix, outputSize, type EditState, type Layer, type Matrix, type Point, type Rect, type Stroke, type TextLayer } from "./model.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Cor de token do design system (anotações nunca usam hexadecimal solto). */
export const tokenColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--bt-color-${name}`).trim();

export const textFont = (size: number) => `800 ${size}px "Manrope", "Segoe UI", sans-serif`;
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
