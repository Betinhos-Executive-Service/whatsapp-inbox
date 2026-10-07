export type SheetLevel = 'half' | 'full'

/** Velocidade (px/ms) que faz um gesto curto contar, como no Sonner/Vaul. Fechar exige mais que expandir. */
const FLICK_DOWN = 0.32
const FLICK_UP = 0.11

/** Decide o destino ao soltar o arrasto: distância (25% para baixo, 15% para cima) ou velocidade. */
export function resolveSnap({ dy, ms, level, height }: { dy: number; ms: number; level: SheetLevel; height: number }): SheetLevel | 'close' {
  const speed = Math.abs(dy) / Math.max(ms, 1)
  if (dy > 0 && (dy > height * 0.25 || speed > FLICK_DOWN)) return level === 'full' ? 'half' : 'close'
  if (dy < 0 && level === 'half' && (-dy > height * 0.15 || speed > FLICK_UP)) return 'full'
  return level
}

/** Fricção crescente ao puxar para cima: nada de parede invisível. */
export function dampen(dy: number) {
  return dy >= 0 ? dy : -8 * Math.sqrt(-dy)
}
