/**
 * O histórico do WhatsApp lista as mensagens de cada conversa da mais nova para a mais antiga
 * (o Baileys trata a primeira de cada conversa como a mais recente). Gravar nessa ordem inverte o
 * desempate por ordem de chegada (rowid) entre mensagens do mesmo segundo, e elas apareciam trocadas
 * na tela. Devolve o lote em ordem cronológica, com os empates na ordem em que foram enviados.
 */
export function chronological<T extends { messageTimestamp?: unknown }>(messages: readonly T[]): T[] {
  const at = (m: T) => Number(m.messageTimestamp ?? 0) || 0;
  // Reverte primeiro (empates ficam do mais antigo para o mais novo) e o sort estável só corrige o resto.
  return [...messages].reverse().sort((a, b) => at(a) - at(b));
}

/**
 * Conta como "ao vivo" (mexe em não lidas, status e alerta) a mensagem que chegou agora ou, ainda que
 * antiga, é mais nova que tudo o que a conversa já tem: o Inbox ficou fechado ou fora do ar e ela chegou
 * atrasada, mas para quem usa é uma mensagem nova, como no celular. `lastAt` é o horário da última
 * mensagem conhecida da conversa (0 ou null quando a conversa não existe).
 */
export function isLiveArrival(live: boolean, at: number, lastAt: number | null | undefined, windowMs: number, now = Date.now()): boolean {
  if (!live) return false;
  if (now - at < windowMs) return true;
  return at >= (lastAt ?? 0);
}
