// Foto de perfil pronta para o toast: 96×96, recortada em círculo, PNG transparente.
// A foto vem do PhotoCache do servidor (mesma miniatura da lista); o recorte fica em disco
// com nome pelo conteúdo, então foto nova gera arquivo novo e a antiga é reaproveitada.
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeImage } from "electron";
import { circleMask } from "./avatar-mask.ts";

const SIZE = 96;

export async function roundAvatar(photo: Buffer, outDir: string): Promise<string | null> {
  const out = join(outDir, `${createHash("sha1").update(photo).digest("hex").slice(0, 16)}.png`);
  try {
    await access(out);
    return out;
  } catch {
    // ainda não recortada
  }
  try {
    const image = nativeImage.createFromBuffer(photo);
    if (image.isEmpty()) return null;
    const square = image.resize({ width: SIZE, height: SIZE, quality: "best" });
    const round = nativeImage.createFromBitmap(circleMask(square.toBitmap(), SIZE), { width: SIZE, height: SIZE });
    await mkdir(outDir, { recursive: true });
    await writeFile(out, round.toPNG());
    return out;
  } catch {
    return null;
  }
}
