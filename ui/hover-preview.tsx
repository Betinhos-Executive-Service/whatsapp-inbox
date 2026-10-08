import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api, type Chat, type Message } from "./api.ts";
import { messageBody } from "./conversation.tsx";
import { formatTime } from "./format.ts";
import { WaInline } from "./wa-format.tsx";

/** Tempo com o mouse parado antes da prévia abrir. */
export const PEEK_DELAY = 650;
const SHOWN = 6;

/** Prévia já buscada por conversa; vale enquanto a última mensagem não mudar. */
const cache = new Map<string, { lastAt: number; list: Message[] }>();

/**
 * Últimas mensagens de uma conversa, sem abri-la: só lê do banco local,
 * não manda recibo de leitura nem zera o contador de não lidas.
 */
export function ChatPeek({ chat, anchor }: { chat: Chat; anchor: DOMRect }) {
  const hit = cache.get(chat.jid);
  const [list, setList] = useState<Message[] | null>(hit && hit.lastAt === chat.lastAt ? hit.list : null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top);

  useEffect(() => {
    if (list) return;
    let alive = true;
    api.messages(chat.jid).then(
      (all) => {
        const last = all.filter((m) => !m.pending).slice(-SHOWN);
        cache.set(chat.jid, { lastAt: chat.lastAt, list: last });
        if (alive) setList(last);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [chat.jid, chat.lastAt, list]);

  // Alinha ao item e não deixa vazar pela base da janela.
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(anchor.top, window.innerHeight - h - 8)));
  }, [anchor.top, list, failed]);

  return (
    <div ref={box} className="chat-peek" role="tooltip" style={{ top, left: anchor.right + 8 }}>
      <div className="chat-peek__head">
        <span className="chat-peek__name">{chat.name}</span>
        <span className="chat-peek__hint">Prévia · não marca como lida</span>
      </div>
      {failed ? (
        <p className="chat-peek__empty">Não foi possível carregar a prévia.</p>
      ) : !list ? (
        <p className="chat-peek__empty">
          <LoaderCircle className="spin" size={14} aria-hidden /> Carregando…
        </p>
      ) : list.length === 0 ? (
        <p className="chat-peek__empty">Sem mensagens.</p>
      ) : (
        <ol className="chat-peek__list">
          {list.map((m) => {
            const { author, body } = messageBody(m, chat.isGroup);
            return (
              <li key={m.id} className={`chat-peek__msg${m.fromMe ? " chat-peek__msg--me" : ""}`}>
                <span className="chat-peek__text">
                  {author && <span className="chat-peek__author">{author}: </span>}
                  {m.deleted ? <em>Mensagem apagada</em> : body ? <WaInline text={body} /> : <em>Mensagem sem texto</em>}
                </span>
                <span className="chat-peek__time">{formatTime(m.at)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
