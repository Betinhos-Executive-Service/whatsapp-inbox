// Selo com o total de não lidas, para o ícone da barra de tarefas do Windows.
// Cores e fonte lidas dos tokens do design system (nada de valor novo).
// O Windows mostra o selo em 16 px lógicos; o resultado sai no tamanho físico exato
// (16 × escala da tela) para não haver reamostragem, que borrava o número.
export const BADGE_FONT = "700 12px Manrope";

const SS = 4; // supersampling: desenha 4× maior e reduz, para bordas e dígitos lisos

// A barra de tarefas não segue o tema do app: lê os tokens do :root claro do
// design-tokens.css, ignorando a redefinição de :root[data-theme='dark'].
function lightToken(name: string): string {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") continue;
      const value = rule.style.getPropertyValue(name).trim();
      if (!value) continue;
      const ref = /^var\((--[\w-]+)\)$/.exec(value);
      return ref ? lightToken(ref[1]) : value;
    }
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function badgeImage(total: number, scale = window.devicePixelRatio || 1): string {
  const size = Math.round(16 * Math.min(Math.max(scale, 1), 4));
  const big = document.createElement("canvas");
  big.width = big.height = size * SS;
  const ctx = big.getContext("2d");
  if (!ctx) return "";
  const family = lightToken("--bt-font-family-sans") || "sans-serif";
  const s = size * SS;
  const c = s / 2;
  // Disco navy chapado: contrasta com o ícone azul sem precisar de anel.
  ctx.fillStyle = lightToken("--bt-color-brand");
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  const over = total > 99;
  const digits = over ? "99" : String(total);
  const px = s * (digits.length > 1 ? 0.6 : 0.7);
  ctx.fillStyle = lightToken("--bt-color-white");
  ctx.font = `700 ${px}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // Centraliza pela altura real dos dígitos (sem descendente), não pela caixa da fonte.
  const ascent = ctx.measureText(digits).actualBoundingBoxAscent || px * 0.72;
  const x = over ? c - s * 0.07 : c;
  ctx.fillText(digits, x, c + ascent / 2, s * (over ? 0.66 : 0.8));
  if (over) {
    ctx.font = `700 ${s * 0.4}px ${family}`;
    ctx.fillText("+", c + s * 0.3, c + s * 0.02, s * 0.28);
  }

  const out = document.createElement("canvas");
  out.width = out.height = size;
  const small = out.getContext("2d");
  if (!small) return "";
  small.imageSmoothingEnabled = true;
  small.imageSmoothingQuality = "high";
  small.drawImage(big, 0, 0, size, size);
  return out.toDataURL("image/png");
}
