/**
 * O histórico do WhatsApp lista as mensagens de cada conversa da mais nova para a mais antiga
 * (o Baileys trata a primeira de cada conversa como a mais recente). Gravar nessa ordem inverte o
 * desempate por ordem de chegada (rowid) entre mensagens do mesmo segundo, e elas apareciam trocadas
 * na tela. Devolve o lote em ordem cronológica, com os empates na ordem em que foram enviados.
 */
export function chronological<T extends { messageTimestamp?: unknown }>(messages: readonly T[]): T[] {
  const at = (m: T) => Number(m.messageTimestamp ?? 0) || 0;
  // Ordena pelo carimbo bruto de propósito: `arrivalAt` só limita o que vai para o banco.
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

let lastSkewWarnAt = 0;
/**
 * Horário de uma mensagem em ms a partir do carimbo do WhatsApp (`messageTimestamp`, em segundos),
 * nunca depois de `now`: o carimbo vem do relógio de quem enviou (celular do contato ou este
 * computador) e, adiantado, a mensagem ficaria "no futuro", depois do que foi enviado daqui.
 */
export function arrivalAt(seconds: unknown, now = Date.now()): number {
  const ms = Number(seconds ?? 0) * 1000;
  if (!ms) return now;
  if (ms <= now) return ms;
  // Um aviso por minuto, para o log apontar o relógio errado sem inundar.
  if (ms - now >= 60_000 && now - lastSkewWarnAt >= 60_000) {
    lastSkewWarnAt = now;
    console.warn(`Mensagem com horário ${Math.round((ms - now) / 60_000)} min no futuro; confira o relógio deste computador e do celular do contato. Gravada com o horário atual.`);
  }
  return now;
}
