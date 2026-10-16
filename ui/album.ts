// Álbum: fotos e vídeos em sequência viram uma bolha só (grade com "+N"), como no WhatsApp.
import type { Message } from "./api.ts";

/** Sem `album` do WhatsApp, agrupa por heurística a partir desta quantidade. */
export const ALBUM_MIN_HEURISTIC = 4;
/** Intervalo máximo entre duas mídias para a heurística juntá-las. */
export const ALBUM_GAP_MS = 60_000;

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Foto ou vídeo sem legenda, sem citação, não apagada/pendente: candidata a álbum. */
export function albumCandidate(m: Message): boolean {
  if (!m.media || (m.media.type !== "image" && m.media.type !== "video")) return false;
  if (m.deleted || m.pending || m.quoted) return false;
  // O texto da mídia é só o rótulo ("[Imagem]") quando não há legenda; em grupo vem "Autor: [Imagem]".
  const text = m.text.replace(/^[^:]{1,60}: /, "");
  return /^\[[^\]]+\]\s*$/.test(text) || text.trim() === "";
}

/**
 * Agrupa em álbuns: itens consecutivos do mesmo remetente e dia, ligados pelo mesmo `media.album` (≥ 2) ou,
 * sem o cabeçalho, por chegarem com menos de 1 min de intervalo (≥ 4, o mínimo do próprio WhatsApp).
 * Devolve, por id da primeira mensagem, a lista do álbum; os demais ids entram em `hidden`.
 */
export function groupAlbums(messages: Message[]): { albums: Map<string, Message[]>; hidden: Set<string> } {
  const albums = new Map<string, Message[]>();
  const hidden = new Set<string>();
  let run: Message[] = [];
  const flush = () => {
    const byId = run.length >= 2 && run[0]!.media?.album && run.every((m) => m.media?.album === run[0]!.media?.album);
    if (byId || run.length >= ALBUM_MIN_HEURISTIC) {
      albums.set(run[0]!.id, run);
      for (const m of run.slice(1)) hidden.add(m.id);
    }
    run = [];
  };
  for (const m of messages) {
    if (!albumCandidate(m)) {
      flush();
      continue;
    }
    const prev = run[run.length - 1];
    const same =
      prev &&
      prev.fromMe === m.fromMe &&
      prev.sender === m.sender &&
      dayKey.format(prev.at) === dayKey.format(m.at) &&
      (prev.media?.album && m.media?.album ? prev.media.album === m.media.album : !prev.media?.album && !m.media?.album && m.at - prev.at < ALBUM_GAP_MS);
    if (!same) flush();
    run.push(m);
  }
  flush();
  return { albums, hidden };
}
