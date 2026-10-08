import type { Message } from "./api.ts";

const two = (n: number) => String(n).padStart(2, "0");

/** Texto copiado de várias mensagens, no formato do WhatsApp: "[14:05, 08/10/2026] Nome: texto". Uma só: só o texto. */
export function selectionText(list: Message[], describe: (m: Message) => { author: string; text: string }): string {
  if (list.length === 1) return describe(list[0]).text;
  return list
    .map((m) => {
      const d = new Date(m.at);
      const { author, text } = describe(m);
      return `[${two(d.getHours())}:${two(d.getMinutes())}, ${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}] ${author}: ${text}`;
    })
    .join("\n");
}
