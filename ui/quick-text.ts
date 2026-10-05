/** Troca {nome} pelo primeiro nome do contato (quando ele tem nome). */
export function fillQuickReply(text: string, contactName: string): string {
  const first = /^\+?\d/.test(contactName) ? "" : contactName.split(/\s+/)[0];
  // Sem nome (só número), "Olá, {nome}!" vira "Olá!" e não "Olá, !".
  const filled = first ? text.replace(/\{nome\}/gi, first) : text.replace(/,?\s*\{nome\}/gi, "");
  return filled.replace(/\s+([,.!?])/g, "$1").replace(/ {2,}/g, " ");
}

/** "/pi" no começo do campo filtra as respostas rápidas cujo atalho começa com "pi". */
export function quickQuery(draft: string): string | null {
  const m = draft.match(/^\/([a-z0-9-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}
