// Figurinha a partir de uma imagem: WebP 512×512 com a imagem inteira dentro (margem transparente), como o WhatsApp.
import { loadBitmap } from "./image-editor/render.ts";

export const STICKER_SIDE = 512;
/** O WhatsApp recusa figurinha estática acima disto. */
const MAX_BYTES = 1024 * 1024;

/** Retângulo onde a imagem `w`×`h` entra inteira e centralizada num quadrado de `side` (não amplia além do original). */
export function stickerFit(w: number, h: number, side = STICKER_SIDE): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(side / Math.max(1, w), side / Math.max(1, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  return { x: Math.floor((side - width) / 2), y: Math.floor((side - height) / 2), width, height };
}

/** Converte a imagem em figurinha (File WebP). Falha com mensagem clara quando o navegador não gera WebP. */
export async function toSticker(file: Blob, name = "figurinha.webp"): Promise<File> {
  const bitmap = await loadBitmap(file);
  try {
    const canvas = new OffscreenCanvas(STICKER_SIDE, STICKER_SIDE);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este computador não consegue preparar a imagem.");
    const { x, y, width, height } = stickerFit(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, x, y, width, height);
    let blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
    if (blob.type !== "image/webp") throw new Error("Este computador não gera figurinhas em WebP.");
    if (blob.size > MAX_BYTES) blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.7 });
    if (blob.size > MAX_BYTES) throw new Error("A figurinha ficou maior que 1 MB. Use uma imagem mais simples.");
    return new File([blob], name, { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
