/** Formatação de texto do WhatsApp: *negrito*, _itálico_, ~tachado~, `código` e ```monoespaçado```. */
export type WaKind = "b" | "i" | "s" | "code" | "mono";
export type WaNode = string | { kind: WaKind; marker: string; children: WaNode[] };

const SINGLE: Record<string, WaKind> = { "*": "b", _: "i", "~": "s", "`": "code" };
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

const push = (out: WaNode[], text: string) => {
  if (!text) return;
  const last = out[out.length - 1];
  if (typeof last === "string") out[out.length - 1] = last + text;
  else out.push(text);
};

/**
 * Mesmas regras do WhatsApp: o marcador de abertura não pode vir colado a uma letra/número
 * antes dele nem ter espaço depois; o de fechamento não pode ter espaço antes nem letra/número
 * depois. Marcadores simples não atravessam linhas; ``` atravessa e não aninha.
 */
export function parseWa(text: string): WaNode[] {
  const out: WaNode[] = [];
  let i = 0;
  while (i < text.length) {
    const prev = text[i - 1];
    const openOk = prev === undefined || !WORD.test(prev);
    if (openOk && text.startsWith("```", i)) {
      const end = text.indexOf("```", i + 4);
      if (end > i + 3 && !WORD.test(text[end + 3] ?? "")) {
        out.push({ kind: "mono", marker: "```", children: [text.slice(i + 3, end)] });
        i = end + 3;
        continue;
      }
    }
    const c = text[i];
    const kind = SINGLE[c];
    if (kind && openOk && text[i + 1] !== undefined && !SPACE.test(text[i + 1]) && text[i + 1] !== c) {
      const close = findClose(text, i + 1, c);
      if (close > 0) {
        const inner = text.slice(i + 1, close);
        out.push({ kind, marker: c, children: kind === "code" ? [inner] : parseWa(inner) });
        i = close + 1;
        continue;
      }
    }
    push(out, c);
    i++;
  }
  return out;
}

function findClose(text: string, from: number, c: string): number {
  for (let j = from + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === "\n") return -1;
    if (ch === c && !SPACE.test(text[j - 1]) && !WORD.test(text[j + 1] ?? "")) return j;
  }
  return -1;
}

/** Texto sem os marcadores — para prévias de uma linha. */
export function stripWa(text: string): string {
  const flat = (nodes: WaNode[]): string => nodes.map((n) => (typeof n === "string" ? n : flat(n.children))).join("");
  return flat(parseWa(text));
}

/** Liga/desliga um marcador em volta da seleção (Ctrl+B, Ctrl+I…). Devolve o novo texto e a nova seleção. */
export function toggleWa(text: string, start: number, end: number, marker: string): { text: string; start: number; end: number } {
  const m = marker.length;
  if (text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
    return { text: text.slice(0, start - m) + text.slice(start, end) + text.slice(end + m), start: start - m, end: end - m };
  }
  const sel = text.slice(start, end);
  if (sel.length > 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
    return { text: text.slice(0, start) + sel.slice(m, -m) + text.slice(end), start, end: end - 2 * m };
  }
  return { text: text.slice(0, start) + marker + sel + marker + text.slice(end), start: start + m, end: end + m };
}
