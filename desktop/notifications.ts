// Texto das notificações do Windows: funções puras, sem Electron, para poder testar.
import type { Chat, Message } from "../server/db.ts";

const MAX = 180;

/** Etiquetas de mídia geradas em server/text.ts → rótulo amigável no toast. */
const LABELS: Record<string, string> = {
  Imagem: "📷 Foto",
  Vídeo: "🎥 Vídeo",
  GIF: "🎞️ GIF",
  "Arquivo de áudio": "🎵 Áudio",
  Figurinha: "Figurinha",
  Localização: "📍 Localização",
  Contato: "👤 Contato",
  Contatos: "👤 Contato",
  Enquete: "📊 Enquete",
};

const TAG = /\[(Imagem|Vídeo|GIF|Áudio|Arquivo de áudio|Documento|Figurinha|Localização|Contatos?|Enquete)\]( ?)(.*)$/s;

const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function notificationBody(message: Pick<Message, "text" | "media">, preview: boolean): string {
  if (!preview) return "Nova mensagem";
  const text = message.text.replace(TAG, (_all, tag: string, space: string, rest: string) => {
    if (tag === "Documento") return `📄 ${rest || "Documento"}`;
    if (tag === "Áudio") {
      const seconds = message.media?.seconds;
      return `🎤 Áudio${seconds ? ` ${duration(seconds)}` : ""}${space}${rest}`;
    }
    return `${LABELS[tag]}${space}${rest}`;
  });
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}

export const isUrgent = (chat: Pick<Chat, "ai">): boolean => chat.ai?.priority === "alta";

export function notificationTitle(chat: Pick<Chat, "name" | "ai">, count: number): string {
  const base = count > 1 ? `${chat.name} · ${count} novas` : chat.name;
  return isUrgent(chat) ? `Urgente · ${base}` : base;
}

/** Mensagens novas desde a última vez que a conversa foi aberta ou lida. */
export class UnreadCounter {
  private counts = new Map<string, number>();
  bump(jid: string): number {
    const next = (this.counts.get(jid) ?? 0) + 1;
    this.counts.set(jid, next);
    return next;
  }
  clear(jid: string): void {
    this.counts.delete(jid);
  }
  get(jid: string): number {
    return this.counts.get(jid) ?? 0;
  }
}
