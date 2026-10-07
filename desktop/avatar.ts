// Foto de perfil pronta para o toast: 96×96, recortada em círculo, PNG transparente.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { nativeImage } from "electron";
import { circleMask } from "./avatar-mask.ts";

const SIZE = 96;

export async function roundAvatar(photo: string, outDir: string): Promise<string | null> {
  const out = join(outDir, basename(photo).replace(/\.jpg$/, ".png"));
  try {
    // Reaproveita o recorte enquanto a foto de origem não mudar.
    if ((await stat(out)).mtimeMs >= (await stat(photo)).mtimeMs) return out;
  } catch {
    // ainda não recortada
  }
  try {
    const image = nativeImage.createFromPath(photo);
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
