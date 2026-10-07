// Círculo 16×16 com o total de não lidas, para o ícone da barra de tarefas do Windows.
// Cores lidas dos tokens do design system (nada de valor novo).
export function badgeImage(total: number): string {
  const size = 32; // desenha em 2x; o Windows reduz para 16
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue("--bt-color-action").trim();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const label = total > 99 ? "99+" : String(total);
  ctx.fillStyle = css.getPropertyValue("--bt-color-white").trim();
  ctx.font = `800 ${label.length > 2 ? 13 : label.length > 1 ? 17 : 20}px ${css.getPropertyValue("font-family") || "sans-serif"}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2 + 1);
  return canvas.toDataURL("image/png");
}
