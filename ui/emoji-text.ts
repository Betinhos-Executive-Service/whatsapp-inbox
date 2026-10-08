// Atalho ":texto", emoticons e seletor de emoji: funções puras do campo de mensagem (testadas em tests/emoji.test.ts).
import type { Emoji } from "./emoji-data.ts";

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const SHORTCUT = /(?:^|\s):([\p{L}\p{N}_+-]{2,30})$/u;

/** Texto digitado depois de ":" até o cursor (":sorr" → "sorr"); null se não é atalho. Pede 2 letras, como o WhatsApp. */
export function emojiQuery(text: string, caret: number): string | null {
  const m = text.slice(0, caret).match(SHORTCUT);
  return m ? m[1] : null;
}

/** Emojis com alguma palavra-chave que começa pelo texto. Nome exato e palavra exata primeiro. */
export function searchEmoji(query: string, list: Emoji[], limit = Infinity): Emoji[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: { e: Emoji; score: number; i: number }[] = [];
  list.forEach((e, i) => {
    // pt exato < pt prefixo < en exato < en prefixo ("|" separa pt de en); empate: palavra mais cedo (nome antes das etiquetas).
    let score = Infinity;
    let en = 0;
    e.keys.forEach((k, at) => {
      if (k === "|") en = 2;
      else if (k === q) score = Math.min(score, en + at / 1000);
      else if (k.startsWith(q)) score = Math.min(score, en + 1 + at / 1000);
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

/**
 * Emoticons que o WhatsApp Web troca por emoji assim que terminam de ser digitados (maiúscula ou minúscula).
 * As formas sem nariz (":)", ":p") ficam como texto, como no WhatsApp.
 */
export const EMOTICONS: Record<string, string> = {
  "(y)": "👍", "(n)": "👎", ":-)": "🙂", ":-(": "🙁", ":-p": "😛", ":-|": "😐", ":-\\": "😕",
  ":-d": "😀", ":-*": "😘", "<3": "❤️", "^_^": "😁", ">_<": "😆", ";-)": "😉",
};

export type EmoticonSwap = { emoticon: string; emoji: string; caret: number };

/** Se o texto antes do cursor termina num emoticon (no começo ou após espaço), troca pelo emoji. */
export function convertEmoticon(text: string, caret: number): { text: string; swap: EmoticonSwap } | null {
  const before = text.slice(0, caret);
  for (const [emoticon, emoji] of Object.entries(EMOTICONS)) {
    const typed = before.slice(-emoticon.length);
    if (typed.toLowerCase() !== emoticon) continue;
    const start = caret - emoticon.length;
    if (start > 0 && !/\s/.test(before[start - 1])) continue;
    const next = before.slice(0, start) + emoji;
    return { text: next + text.slice(caret), swap: { emoticon: typed, emoji, caret: next.length } };
  }
  return null;
}

/** Backspace logo depois da troca devolve o emoticon digitado, como no WhatsApp. */
export function undoEmoticon(text: string, swap: EmoticonSwap): { text: string; caret: number } | null {
  const start = swap.caret - swap.emoji.length;
  if (text.slice(start, swap.caret) !== swap.emoji) return null;
  const before = text.slice(0, start) + swap.emoticon;
  return { text: before + text.slice(swap.caret), caret: before.length };
}
