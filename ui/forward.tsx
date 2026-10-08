import { Check, LoaderCircle, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Chat, type Message } from "./api.ts";
import { initials, normalize } from "./format.ts";
import { Alert, Button, SearchBox } from "./ds/index.ts";

/** Mesmo limite do WhatsApp para encaminhar de uma vez. */
export const MAX_FORWARD = 5;

/**
 * Lista de conversas com marcação múltipla (como o "Encaminhar para…" do WhatsApp):
 * marca até `max`, vê as escolhidas em fichas e confirma no botão de enviar.
 * Fecha por X, Esc ou clique fora (exceto enquanto envia).
 */
export function ChatPicker({ title, preview, max, filter, sendLabel, onClose, onSend }: {
  title: string;
  preview?: ReactNode;
  max: number;
  filter?: (c: Chat) => boolean;
  sendLabel: (n: number) => string;
  onClose: () => void;
  /** Lança erro para mostrar no diálogo; resolve para fechar. */
  onSend: (picked: Chat[]) => Promise<void>;
}) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Chat[]>([]);
  const [sending, setSending] = useState(false);
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
      if (e.key === "Escape" && !sending) {
        e.stopPropagation();
        onClose();
      }
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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, sending]);

  const list = useMemo(() => {
    const q = normalize(query.trim());
    return (chats ?? []).filter((c) => (!filter || filter(c)) && (!q || normalize(`${c.name} ${c.phone ?? ""}`).includes(q))).slice(0, 80);
  }, [chats, query, filter]);

  const isPicked = (c: Chat) => picked.some((p) => p.jid === c.jid);
  const toggle = (c: Chat) => {
    setError(null);
    if (isPicked(c)) setPicked((l) => l.filter((p) => p.jid !== c.jid));
    else if (picked.length >= max) setError(`Dá para escolher até ${max} de uma vez.`);
    else setPicked((l) => [...l, c]);
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await onSend(picked);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal__overlay" onClick={() => !sending && onClose()} />
      <div className="modal__panel surface forward-dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title" ref={panel}>
        <div className="forward-dialog__head">
          <h2 id="picker-title" className="heading-card">
            {title}
          </h2>
          <Button variant="ghost" size="compact" icon={<X size={18} aria-hidden />} aria-label="Fechar" disabled={sending} onClick={onClose} />
        </div>
        {preview}
        <SearchBox ref={search} aria-label="Buscar conversa" placeholder="Nome ou número" value={query} onChange={setQuery} />
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        {chats === null ? (
          <p className="hint forward-dialog__empty">
            <LoaderCircle className="spin" size={16} aria-hidden /> Carregando conversas…
          </p>
        ) : list.length === 0 ? (
          <p className="hint forward-dialog__empty">Nenhuma conversa encontrada para esta busca.</p>
        ) : (
          <ul className="forward-dialog__list" aria-label="Conversas" aria-multiselectable="true">
            {list.map((c) => {
              const on = isPicked(c);
              return (
                <li key={c.jid}>
                  <button type="button" className="forward-dialog__item" aria-pressed={on} disabled={sending} onClick={() => toggle(c)}>
                    <span className={`avatar${on ? " avatar--picked" : ""}`} aria-hidden>
                      {on ? <Check size={16} /> : initials(c.name)}
                    </span>
                    <span className="forward-dialog__name">
                      {c.name}
                      {c.phone && <span className="hint">+{c.phone}</span>}
                    </span>
                    <span className={`forward-dialog__check${on ? " is-on" : ""}`} aria-hidden>
                      {on && <Check size={14} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="forward-dialog__foot">
          <span className="forward-dialog__picked" aria-live="polite">
            {picked.length ? picked.map((c) => c.name).join(", ") : "Escolha uma ou mais conversas"}
          </span>
          <Button variant="primary" icon={<Send size={16} aria-hidden />} loading={sending} disabled={!picked.length} onClick={() => void send()}>
            {sendLabel(picked.length)}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Encaminha as mensagens, na ordem, para cada conversa escolhida. */
export function ForwardDialog({ messages, onClose, onDone }: { messages: Message[]; onClose: () => void; onDone: (to: Chat[]) => void }) {
  const total = messages.length;
  return (
    <ChatPicker
      title={total === 1 ? "Encaminhar mensagem" : `Encaminhar ${total} mensagens`}
      preview={<p className="forward-dialog__preview">{messages.map((m) => m.text).join("\n")}</p>}
      max={MAX_FORWARD}
      sendLabel={(n) => (n > 1 ? `Encaminhar para ${n}` : "Encaminhar")}
      onClose={onClose}
      onSend={async (to) => {
        const done: string[] = [];
        for (const chat of to) {
          try {
            for (const m of messages) await api.forward(m.chatJid, m.id, chat.jid);
            done.push(chat.name);
          } catch (e) {
            const ok = done.length ? ` Já foi para: ${done.join(", ")}.` : "";
            throw new Error(`Não foi possível encaminhar para ${chat.name}. ${(e as Error).message}${ok}`);
          }
        }
        onDone(to);
      }}
    />
  );
}
