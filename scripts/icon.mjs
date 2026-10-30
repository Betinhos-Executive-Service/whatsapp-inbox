// Gera dist/icon.ico (e o PNG do Linux) sem arquivo externo: bloco de marca do design system
// (quadrado azul de ação com cantos de 11/40) e um balão de conversa branco.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const BLUE = [0x21, 0x59, 0xd2]; // --bt-color-action
const WHITE = [0xff, 0xff, 0xff];

function roundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function triangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by);
  const d2 = s(x, y, bx, by, cx, cy);
  const d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Cor e cobertura de um ponto, em coordenadas de 0 a 1. */
function sample(u, v) {
  if (!roundedRect(u, v, 0, 0, 1, 1, 11 / 40)) return null;
  const bubble = roundedRect(u, v, 0.22, 0.25, 0.78, 0.66, 0.11) || triangle(u, v, [0.3, 0.6], [0.3, 0.8], [0.48, 0.64]);
  if (!bubble) return BLUE;
  const line = (top, right) => u >= 0.33 && u <= right && v >= top && v <= top + 0.055;
  return line(0.36, 0.67) || line(0.48, 0.56) ? BLUE : WHITE;
}

/** Pixels RGBA, de cima para baixo. */
function rgba(size) {
  const ss = 4; // supersampling para bordas suaves
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
      }
      pixels[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return pixels;
}

function image(size) {
  const src = rgba(size);
  const pixels = Buffer.alloc(src.length);
  // DIB: linhas de baixo para cima, canais BGRA.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4;
      pixels[d] = src[s + 2];
      pixels[d + 1] = src[s + 1];
      pixels[d + 2] = src[s];
      pixels[d + 3] = src[s + 3];
    }
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, pixels, mask]);
}

export function writeIcon(path) {
  const sizes = [16, 24, 32, 48, 64, 256];
  const images = sizes.map(image);
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((size, i) => {
    const e = 6 + 16 * i;
    dir[e] = size === 256 ? 0 : size;
    dir[e + 1] = size === 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(images[i].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.concat([dir, ...images]));
}

/** PNG para Linux (janela, bandeja, notificação e o ícone do AppImage). */
export function writePng(path, size = 512) {
  const src = rgba(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) src.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) writeIcon(resolve("dist/icon.ico"));
