import { Reply, Sparkles, Users, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Chat, Message, Participant } from "./api.ts";
import { Avatar } from "./avatar.tsx";
import { Button, Dialog } from "./ds/index.ts";
import { listTime, normalize } from "./format.ts";
import { WaInline } from "./wa-format.tsx";

import { MENTION_ALL, MENTION_ALL_LABEL } from "./mentions.ts";

export { applyMentions, insertMention, mentionQuery, type MentionPick } from "./mentions.ts";

export const mentionLabel = (p: Participant) => (p.jid === MENTION_ALL ? MENTION_ALL_LABEL : p.name.replace(/^\+/, ""));

/** Item "@todos" no topo da lista de menções do grupo. */
const ALL: Participant = { jid: MENTION_ALL, name: "Todos do grupo", phone: null, admin: false, me: false };

/** Em grupo, "@todos" vem primeiro quando combina com o que foi digitado ("t", "tod", "all"). */
export function filterParticipants(list: Participant[], query: string, isGroup = false): Participant[] {
  const q = normalize(query);
  const people = list.filter((p) => !p.me && (!q || normalize(p.name).includes(q) || (p.phone ?? "").includes(q)));
  const all = isGroup && (MENTION_ALL_LABEL.startsWith(q) || "all".startsWith(q)) ? [ALL] : [];
  return [...all, ...people].slice(0, 8);
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
          {p.jid === MENTION_ALL ? (
            <span className="avatar avatar--sm" aria-hidden>
              <Users size={14} />
            </span>
          ) : (
            <Avatar jid={p.jid} name={p.name} className="avatar--sm" />
          )}
          <span className="quick-menu__shortcut">@{mentionLabel(p)}</span>
          {p.jid === MENTION_ALL ? (
            <span className="quick-menu__text">Notifica todos do grupo</span>
          ) : (
            p.phone && p.name !== `+${p.phone}` && <span className="quick-menu__text">+{p.phone}</span>
          )}
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
      <Button variant="ghost" size="compact" icon={<X size={16} aria-hidden />} aria-label="Cancelar resposta" onClick={onCancel} />
    </div>
  );
}

/**
 * Resposta proposta por uma IA (Claude Code via MCP) à espera da pessoa: nada sai sem Enviar.
 * Mesma linha visual da ReplyBar; superfície neutra para separar do campo de texto.
 */
export function PendingDraftBar({ draft, busy, onSend, onEdit, onDiscard }: {
  draft: NonNullable<Chat["pendingDraft"]>;
  busy: boolean;
  onSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  const who = draft.source === "claude" ? "Claude" : draft.source;
  return (
    <div className="pending-bar" role="status" aria-busy={busy || undefined}>
      <Sparkles className="pending-bar__icon" size={16} aria-hidden />
      <div className="quote quote--static">
        <span className="quote__author">
          Rascunho do {who} · {listTime(draft.createdAt)}
          {draft.hasMedia && " · com anexo"}
        </span>
        <span className="quote__text">{draft.text ? <WaInline text={draft.text} /> : "Só o anexo, sem legenda"}</span>
      </div>
      <div className="pending-bar__actions">
        <Button variant="action" size="compact" loading={busy} onClick={onSend}>
          Enviar
        </Button>
        <Button variant="secondary" size="compact" disabled={busy} onClick={onEdit}>
          Editar
        </Button>
        <Button variant="ghost" size="compact" disabled={busy} onClick={onDiscard}>
          Descartar
        </Button>
      </div>
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
  return (
    <Dialog
      open
      tone="danger"
      title="Apagar mensagem?"
      onClose={() => !busy && onCancel()}
      actions={
        <>
          <Button ref={cancel} variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button variant={everyone ? "secondary" : "danger"} onClick={() => onConfirm("me")} disabled={busy}>
            Apagar para mim
          </Button>
          {everyone && (
            <Button variant="danger" onClick={() => onConfirm("everyone")} loading={busy}>
              Apagar para todos
            </Button>
          )}
        </>
      }
    >
      {everyone
        ? "Para todos: some do WhatsApp de quem recebeu e fica o aviso de mensagem apagada. Para mim: sai só do seu WhatsApp."
        : message.fromMe && !message.deleted
          ? "Já passou o prazo do WhatsApp para apagar para todos. Dá para apagar só para você."
          : "A mensagem sai só do seu WhatsApp; quem enviou continua vendo."}
    </Dialog>
  );
}
