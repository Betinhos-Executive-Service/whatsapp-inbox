// Selo com o total de não lidas, para o ícone da barra de tarefas do Windows.
// Cores e fonte lidas dos tokens do design system (nada de valor novo).
// O Windows mostra o selo em 16 px lógicos; desenhamos no tamanho físico exato
// (16 × escala da tela) para não haver reamostragem, que borrava o número.
export const BADGE_FONT = "800 12px Manrope";

export function badgeImage(total: number, scale = window.devicePixelRatio || 1): string {
  const size = Math.round(16 * Math.min(Math.max(scale, 1), 4));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const family = token("--bt-font-family-sans") || "sans-serif";
  const c = size / 2;
  // Anel branco separa o selo do ícone do app logo abaixo.
  const ring = Math.max(1, Math.round(size / 16));
  ctx.fillStyle = token("--bt-color-white");
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = token("--bt-color-action");
  ctx.beginPath();
  ctx.arc(c, c, c - ring, 0, Math.PI * 2);
  ctx.fill();

  const inner = size - ring * 2;
  const over = total > 99;
  const digits = over ? "99" : String(total);
  // Dígitos ocupam o máximo do círculo; com dois, a largura é comprimida se preciso.
  const px = Math.round(size * (digits.length > 1 ? 0.64 : 0.74));
  ctx.fillStyle = token("--bt-color-white");
  ctx.font = `800 ${px}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // Centraliza pela altura real dos dígitos (sem descendente), não pela caixa da fonte.
  const ascent = ctx.measureText(digits).actualBoundingBoxAscent || px * 0.72;
  const x = over ? c - size * 0.07 : c;
  ctx.fillText(digits, x, Math.round(c + ascent / 2), inner * (over ? 0.7 : 0.86));
  if (over) {
    ctx.font = `800 ${Math.round(size * 0.42)}px ${family}`;
    ctx.fillText("+", c + size * 0.3, c + size * 0.02, inner * 0.3);
  }
  return canvas.toDataURL("image/png");
}
