import { LoaderCircle, Reply, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Message, Participant } from "./api.ts";
import { Avatar } from "./avatar.tsx";
import { normalize } from "./format.ts";

export { applyMentions, insertMention, mentionQuery, type MentionPick } from "./mentions.ts";

export const mentionLabel = (p: Participant) => p.name.replace(/^\+/, "");

export function filterParticipants(list: Participant[], query: string): Participant[] {
  const q = normalize(query);
  return list.filter((p) => !p.me && (!q || normalize(p.name).includes(q) || (p.phone ?? "").includes(q))).slice(0, 8);
}

export function MentionMenu({ items, active, onPick, onHover }: {
  items: Participant[];
  active: number;
  onPick: (p: Participant) => void;
  onHover: (i: number) => void;
}) {
  return (
    <ul className="quick-menu" role="listbox" id="mention-menu" aria-label="Mencionar">
      {items.map((p, i) => (
        <li
          key={p.jid}
          id={`mention-${i}`}
          role="option"
          aria-selected={i === active}
          className="quick-menu__item mention-item"
          // mousedown para não tirar o foco do campo antes de escolher
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(p);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <Avatar jid={p.jid} name={p.name} className="avatar--sm" />
          <span className="quick-menu__shortcut">@{mentionLabel(p)}</span>
          {p.phone && p.name !== `+${p.phone}` && <span className="quick-menu__text">+{p.phone}</span>}
        </li>
      ))}
    </ul>
  );
}

// ---- responder

/** Quem escreveu a mensagem citada, como aparece no WhatsApp. */
export const quoteAuthor = (q: { fromMe: boolean; author: string | null }, chatName: string) => (q.fromMe ? "Você" : (q.author ?? chatName));

/** Em grupo, o texto salvo começa com "Autor: ". */
export function messageBody(m: Message, isGroup: boolean): { author: string | null; body: string } {
  if (!isGroup || m.fromMe) return { author: null, body: m.text };
  const i = m.text.indexOf(": ");
  return i > 0 && i <= 60 ? { author: m.text.slice(0, i), body: m.text.slice(i + 2) } : { author: null, body: m.text };
}

export function ReplyBar({ message, isGroup, chatName, onCancel }: { message: Message; isGroup: boolean; chatName: string; onCancel: () => void }) {
  const { author, body } = messageBody(message, isGroup);
  return (
    <div className="reply-bar" role="status">
      <Reply size={16} aria-hidden />
      <div className="quote quote--static">
        <span className="quote__author">Respondendo a {message.fromMe ? "você" : (author ?? chatName)}</span>
        <span className="quote__text">{body}</span>
      </div>
      <button type="button" className="icon-button icon-button--plain" aria-label="Cancelar resposta" onClick={onCancel}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

// ---- apagar

/** WhatsApp apaga para todos só até ~2 dias e meio depois do envio (o servidor confere de novo). */
export const canRevoke = (m: Message, now = Date.now()) => m.fromMe && !m.deleted && now - m.at < 60 * 3_600_000;

export function DeleteDialog({ message, busy, onCancel, onConfirm }: {
  message: Message;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: "everyone" | "me") => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const everyone = canRevoke(message);
  useEffect(() => {
    requestAnimationFrame(() => cancel.current?.focus());
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return (
    <div className="modal">
      <div className="modal__overlay" onClick={() => !busy && onCancel()} aria-hidden />
      <div className="modal__panel surface update-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-text">
        <div className="update-dialog__icon update-dialog__icon--danger">
          <Trash2 size={20} aria-hidden />
        </div>
        <h2 id="delete-title" className="heading-detail">Apagar mensagem?</h2>
        <p id="delete-text" className="update-dialog__text">
          {everyone
            ? "Para todos: some do WhatsApp de quem recebeu e fica o aviso de mensagem apagada. Para mim: sai só do seu WhatsApp."
            : message.fromMe && !message.deleted
              ? "Já passou o prazo do WhatsApp para apagar para todos. Dá para apagar só para você."
              : "A mensagem sai só do seu WhatsApp; quem enviou continua vendo."}
        </p>
        <div className="cluster update-dialog__actions">
          <button ref={cancel} type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={`button ${everyone ? "button--secondary" : "button--danger"}`} onClick={() => onConfirm("me")} disabled={busy} aria-busy={busy || undefined}>
            Apagar para mim
          </button>
          {everyone && (
            <button type="button" className="button button--danger" onClick={() => onConfirm("everyone")} disabled={busy} aria-busy={busy || undefined}>
              {busy && <LoaderCircle className="spin" size={16} aria-hidden />}
              Apagar para todos
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
