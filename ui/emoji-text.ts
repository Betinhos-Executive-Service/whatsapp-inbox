// Atalho ":texto" e seletor de emoji: funções puras do campo de mensagem (testadas em tests/emoji.test.ts).
import { EMOJIS, type Emoji } from "./emoji-data.ts";

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Texto digitado depois de ":" até o cursor (":sorr" → "sorr"); null se não é atalho. Pede 2 letras, como o WhatsApp. */
export function emojiQuery(text: string, caret: number): string | null {
  const m = text.slice(0, caret).match(/(?:^|\s):([\p{L}\p{N}_+-]{2,30})$/u);
  return m ? m[1] : null;
}

/** Emojis cuja palavra-chave começa (ou, com 3+ letras, contém) o texto. Exatos e prefixos primeiro. */
export function searchEmoji(query: string, limit = Infinity, list: Emoji[] = EMOJIS): Emoji[] {
  const q = fold(query.trim()).replace(/\s+/g, "_");
  if (!q) return [];
  const scored: { e: Emoji; score: number; i: number }[] = [];
  list.forEach((e, i) => {
    // Exato < prefixo < contém; empate vai para quem tem a palavra mais cedo ("coracao" → ❤️ antes de 😍).
    let score = Infinity;
    e.keys.forEach((key, at) => {
      const k = fold(key);
      const base = k === q ? 0 : k.startsWith(q) ? 1 : q.length >= 3 && k.includes(q) ? 2 : Infinity;
      score = Math.min(score, base + at / 100);
    });
    if (score < Infinity) scored.push({ e, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).slice(0, limit).map((s) => s.e);
}

/** Troca ":query" antes do cursor pelo emoji. Devolve o texto e a nova posição do cursor. */
export function insertEmojiShortcut(text: string, caret: number, emoji: string): { text: string; caret: number } {
  const rest = text.slice(caret);
  const before = text.slice(0, caret).replace(/:([\p{L}\p{N}_+-]{2,30})$/u, emoji);
  return { text: before + rest, caret: before.length };
}

/** Põe o emoji no lugar da seleção (ou no cursor). */
export function insertAt(text: string, start: number, end: number, emoji: string): { text: string; caret: number } {
  const before = text.slice(0, start) + emoji;
  return { text: before + text.slice(end), caret: before.length };
}

/** Recentes: o usado vai para a frente, sem repetir, até `max`. */
export const pushRecent = (list: string[], emoji: string, max = 32) => [emoji, ...list.filter((e) => e !== emoji)].slice(0, max);
