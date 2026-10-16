// Presença do contato (digitando, gravando, online, visto por último) reduzida a um estado só, a partir do
// `presence.update` do Baileys. Função pura, para testar sem WhatsApp.

export type PresenceState = "composing" | "recording" | "available" | "unavailable" | null;

export type Presence = {
  state: PresenceState;
  /** "Visto por último" em ms; só vem quando o contato deixa ver (privacidade) e está offline. */
  lastSeen: number | null;
};

type Raw = { lastKnownPresence?: string; lastSeen?: number };

const PRIORITY: Exclude<PresenceState, null>[] = ["recording", "composing", "available", "unavailable"];

/**
 * Em conversa individual, vale o estado mais "vivo" (gravando > digitando > online > offline).
 * Em grupo, só interessa quem está digitando ou gravando: "online" de participante não vai para o cabeçalho.
 */
export function presenceOf(presences: Record<string, Raw>, isGroup: boolean): Presence {
  const list = Object.values(presences);
  const states = new Set(list.map((p) => p.lastKnownPresence));
  const allowed = isGroup ? PRIORITY.slice(0, 2) : PRIORITY;
  const state = allowed.find((s) => states.has(s)) ?? null;
  const seen = isGroup ? undefined : list.map((p) => p.lastSeen).find((n) => typeof n === "number" && n > 0);
  return { state, lastSeen: seen ? seen * 1000 : null };
}
