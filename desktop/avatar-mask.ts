// Recorte circular da foto de perfil, direto nos bytes BGRA (sem canvas no processo principal).
// O Windows não arredonda o ícone do toast sem toastXml; um PNG com fundo transparente resolve.

/** Aplica um círculo com borda suavizada; as cores são multiplicadas junto (BGRA pré-multiplicado do Chromium). */
export function circleMask(bgra: Buffer, size: number): Buffer {
  const out = Buffer.from(bgra);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coverage = Math.min(1, Math.max(0, r - Math.hypot(x + 0.5 - r, y + 0.5 - r) + 0.5));
      // Cobertura quase total fica intacta: o pixel do meio da borda tocaria 254 em vez de 255.
      if (coverage > 0.99) continue;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 4; k++) out[i + k] = Math.round(out[i + k] * coverage);
    }
  }
  return out;
}
