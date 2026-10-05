import type { Chat } from "./api.ts";

/**
 * Nota de 0 a 1 para "quem responder primeiro". Usa o que o Jev disse (espera resposta,
 * urgência), lembrete vencido, não lidas e há quanto tempo o contato espera. Conversa
 * resolvida ou em que eu falei por último fica no fim.
 */
export function priorityScore(chat: Chat, now = Date.now()): number {
  if (chat.status === "resolvida") return 0;
  const reminderDue = chat.reminderAt !== null && chat.reminderAt <= now ? 1 : 0;
  if (chat.lastFromMe && !reminderDue) return 0.05;
  const waitingHours = Math.max(0, (now - chat.lastAt) / 3600_000);
  const waiting = Math.min(waitingHours / 24, 1);
  const needsReply = chat.ai?.needsReply ?? (chat.lastFromMe ? 0 : 0.6);
  const urgent = chat.ai?.urgent ?? 0;
  const unread = chat.unread > 0 ? 1 : 0;
  return Math.min(1, 0.35 * needsReply + 0.3 * urgent + 0.15 * waiting + 0.1 * unread + 0.3 * reminderDue);
}

export const priorityLevel = (score: number): "alta" | "media" | null => (score >= 0.6 ? "alta" : score >= 0.4 ? "media" : null);
