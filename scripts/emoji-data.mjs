// Gera ui/emoji-data.ts com o catálogo Unicode completo e as palavras-chave CLDR em português e inglês
// (as mesmas fontes que o WhatsApp usa nas sugestões de ":texto"). Vem de emojibase-data (devDependency).
// O arquivo gerado fica versionado, como o ui/ds/. Uso: node scripts/emoji-data.mjs
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const pt = require("emojibase-data/pt/compact.json");
const en = new Map(require("emojibase-data/en/compact.json").map((e) => [e.hexcode, e]));
const shortcodes = require("emojibase-data/en/shortcodes/cldr.json");

// Grupos Unicode → abas do WhatsApp (sorrisos e pessoas juntos; "componentes" fica de fora).
const CATEGORY = { 0: "pessoas", 1: "pessoas", 3: "natureza", 4: "comida", 5: "viagem", 6: "atividades", 7: "objetos", 8: "simbolos", 9: "bandeiras" };
const ORDER = ["pessoas", "natureza", "comida", "atividades", "viagem", "objetos", "simbolos", "bandeiras"];

const fold = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const words = (s) => fold(s).split(/[\s:,.()“”"'’!-]+/).filter(Boolean);

const lines = Object.fromEntries(ORDER.map((c) => [c, []]));
for (const e of [...pt].sort((a, b) => a.order - b.order)) {
  const category = CATEGORY[e.group];
  if (!category) continue;
  const eng = en.get(e.hexcode);
  const codes = [shortcodes[e.hexcode] ?? []].flat();
  // Português primeiro; depois do "|" vem o inglês (sugestão em pt ganha de en no empate).
  const ptKeys = new Set([...words(e.label), ...(e.tags ?? []).flatMap(words)]);
  const enKeys = new Set([
    ...codes.map(fold), ...codes.flatMap((c) => c.split("_")),
    ...words(eng?.label ?? ""), ...(eng?.tags ?? []).flatMap(words),
  ].filter((k) => !ptKeys.has(k)));
  lines[category].push(`${e.unicode}\t${e.label}\t${[...ptKeys, "|", ...enKeys].join(" ")}`);
}

const body = ORDER.map((c) => `  ${c}: ${JSON.stringify(lines[c].join("\n"))},`).join("\n");
const out = `// GERADO por scripts/emoji-data.mjs a partir de emojibase-data (Unicode/CLDR pt + en). Não edite à mão.
// Cada linha: emoji, nome em português e palavras-chave sem acento: pt, "|", en + shortcodes.

export type EmojiCategory = ${ORDER.map((c) => JSON.stringify(c)).join(" | ")};
export type Emoji = { char: string; name: string; keys: string[]; category: EmojiCategory };

const RAW: Record<EmojiCategory, string> = {
${body}
};

export const EMOJI_CATEGORIES: { id: EmojiCategory; label: string }[] = [
  { id: "pessoas", label: "Smileys e pessoas" },
  { id: "natureza", label: "Animais e natureza" },
  { id: "comida", label: "Comidas e bebidas" },
  { id: "atividades", label: "Atividades" },
  { id: "viagem", label: "Viagens e lugares" },
  { id: "objetos", label: "Objetos" },
  { id: "simbolos", label: "Símbolos" },
  { id: "bandeiras", label: "Bandeiras" },
];

export const EMOJIS: Emoji[] = EMOJI_CATEGORIES.flatMap(({ id }) =>
  RAW[id].split("\\n").map((line) => {
    const [char, name, keys] = line.split("\\t");
    return { char, name, keys: keys.split(" "), category: id };
  }),
);
`;
await writeFile(resolve(import.meta.dirname, "../ui/emoji-data.ts"), out);
console.log(`ui/emoji-data.ts: ${ORDER.reduce((n, c) => n + lines[c].length, 0)} emojis, ${(out.length / 1024).toFixed(0)} KB`);
