// Forma de onda da mensagem de voz, no formato que o WhatsApp usa: 64 amostras inteiras de 0 a 100.

export const WAVEFORM_BARS = 64;

/** Média de |x| por bloco, normalizada pelo pico; silêncio total vira zeros (sem NaN). */
export function waveformFrom(samples: ArrayLike<number>, bars = WAVEFORM_BARS): number[] {
  const n = samples.length;
  const out = new Array<number>(bars).fill(0);
  if (!n) return out;
  const size = n / bars;
  let peak = 0;
  for (let b = 0; b < bars; b++) {
    const start = Math.floor(b * size);
    const end = Math.max(start + 1, Math.floor((b + 1) * size));
    let sum = 0;
    for (let i = start; i < end && i < n; i++) sum += Math.abs(samples[i] ?? 0);
    out[b] = sum / (Math.min(end, n) - start);
    if (out[b]! > peak) peak = out[b]!;
  }
  if (!peak) return out.fill(0);
  return out.map((v) => Math.min(100, Math.floor((v / peak) * 100)));
}

/** Decodifica o áudio gravado (WebM/Opus) com a Web Audio e tira a forma de onda; null se o navegador não decodificar. */
export async function computeWaveform(bytes: Uint8Array): Promise<number[] | null> {
  if (typeof AudioContext === "undefined") return null;
  const ctx = new AudioContext();
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const buffer = await ctx.decodeAudioData(copy.buffer);
    return waveformFrom(buffer.getChannelData(0));
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
