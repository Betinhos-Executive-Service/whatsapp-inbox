// Menções com @: funções puras do campo de mensagem (testadas em tests/mentions.test.ts).

/** Texto digitado depois de "@" até o cursor ("@ana" → "ana"); null se não está mencionando. */
export function mentionQuery(text: string, caret: number): string | null {
  const m = text.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,30})$/);
  return m ? m[1] : null;
}

export type MentionPick = { label: string; jid: string };

/** Escolha especial "@todos": menciona o grupo inteiro (como o @todos do WhatsApp). */
export const MENTION_ALL = "__all__";
export const MENTION_ALL_LABEL = "todos";

/** Troca "@query" antes do cursor por "@Nome ". Devolve o texto e a nova posição do cursor. */
export function insertMention(text: string, caret: number, label: string): { text: string; caret: number } {
  const rest = text.slice(caret);
  // Espaço depois do nome, salvo se já vem espaço ou pontuação.
  const sep = /^[\s.,;:!?)]/.test(rest) ? "" : " ";
  const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${label}${sep}`);
  return { text: before + rest, caret: before.length };
}

/**
 * "@Nome" no texto vira "@5511…" (o WhatsApp mostra o nome para quem recebe) e entra na
 * lista de menções. Nome mais longo primeiro, para "@Ana Paula" não virar "@Ana" + " Paula".
 */
export function applyMentions(text: string, picks: MentionPick[]): { text: string; mentions: string[]; mentionAll: boolean } {
  let out = text;
  const mentions: string[] = [];
  let mentionAll = false;
  for (const p of [...picks].sort((a, b) => b.label.length - a.label.length)) {
    const token = `@${p.label}`;
    if (!out.includes(token)) continue;
    // "@todos" fica escrito assim; quem recebe vê a menção ao grupo.
    if (p.jid === MENTION_ALL) {
      mentionAll = true;
      continue;
    }
    out = out.split(token).join(`@${p.jid.split("@")[0]}`);
    if (!mentions.includes(p.jid)) mentions.push(p.jid);
  }
  return { text: out, mentions, mentionAll };
}

