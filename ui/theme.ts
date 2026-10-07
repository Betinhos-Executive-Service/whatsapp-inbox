import type { Theme } from "./api.ts";

// Tema da interface. "system" segue o Windows e muda junto com ele. A escolha também fica no
// localStorage para o index.html aplicar antes da primeira pintura (sem piscar ao abrir).
const KEY = "inbox:theme";
const media = matchMedia("(prefers-color-scheme: dark)");
let current: Theme = "system";

function paint() {
  const dark = current === "dark" || (current === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
media.addEventListener("change", () => current === "system" && paint());

export function applyTheme(theme: Theme) {
  current = theme;
  paint();
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // preferência só deste computador
  }
}

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}
