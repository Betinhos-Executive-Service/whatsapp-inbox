import { Forward, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Chat, type Message } from "./api.ts";
import { initials, normalize } from "./format.ts";

/** Escolhe a conversa de destino e encaminha a mensagem. Fecha por X, Esc ou clique fora. */
export function ForwardDialog({ message, onClose, onDone }: { message: Message; onClose: () => void; onDone: (chat: Chat) => void }) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => search.current?.focus());
    api.chats().then(setChats).catch((e) => setError((e as Error).message));
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
      // Foco fica dentro do diálogo.
      if (e.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>("input, button:not(:disabled)")];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const list = useMemo(() => {
    const q = normalize(query.trim());
    return (chats ?? []).filter((c) => !q || normalize(`${c.name} ${c.phone ?? ""}`).includes(q)).slice(0, 50);
  }, [chats, query]);

  const send = async (to: Chat) => {
    setSending(to.jid);
    setError(null);
    try {
      await api.forward(message.chatJid, message.id, to.jid);
      onDone(to);
    } catch (e) {
      setError(`Não foi possível encaminhar. ${(e as Error).message}`);
      setSending(null);
    }
  };

  return (
    <div className="modal">
      <div className="modal__overlay" onClick={() => !sending && onClose()} />
      <div className="modal__panel surface forward-dialog" role="dialog" aria-modal="true" aria-labelledby="forward-title" ref={panel}>
        <div className="forward-dialog__head">
          <h2 id="forward-title" className="heading-card">
            Encaminhar mensagem
          </h2>
          <button type="button" className="icon-button icon-button--plain" aria-label="Fechar" disabled={!!sending} onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <p className="forward-dialog__preview">{message.text}</p>
        <label className="search">
          <Search size={16} aria-hidden />
          <span className="sr-only">Buscar conversa</span>
          <input ref={search} type="search" placeholder="Nome ou número" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {error && (
          <p className="forward-dialog__error" role="alert">
            {error}
          </p>
        )}
        {chats === null ? (
          <p className="hint forward-dialog__empty">
            <LoaderCircle className="spin" size={16} aria-hidden /> Carregando conversas…
          </p>
        ) : list.length === 0 ? (
          <p className="hint forward-dialog__empty">Nenhuma conversa encontrada para esta busca.</p>
        ) : (
          <ul className="forward-dialog__list" aria-label="Conversas">
            {list.map((c) => (
              <li key={c.jid}>
                <button type="button" className="forward-dialog__item" disabled={!!sending} aria-busy={sending === c.jid || undefined} onClick={() => void send(c)}>
                  <span className="avatar" aria-hidden>
                    {initials(c.name)}
                  </span>
                  <span className="forward-dialog__name">
                    {c.name}
                    {c.phone && <span className="hint">+{c.phone}</span>}
                  </span>
                  {sending === c.jid ? <LoaderCircle className="spin" size={16} aria-hidden /> : <Forward size={16} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
