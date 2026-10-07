import { Check, CheckCheck, Clock, Pencil, SmilePlus, X } from "lucide-react";
import { useState } from "react";
import type { Message } from "./api.ts";

/** Reações rápidas, as mesmas do WhatsApp. São conteúdo da mensagem, não ícones da interface. */
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** WhatsApp só deixa editar texto até 15 min depois do envio (o servidor confere de novo). */
export const canEdit = (m: Message, now = Date.now()) => m.fromMe && !m.deleted && m.kind === "text" && now - m.at <= 15 * 60_000;

const ACK_LABEL: Record<number, string> = { 1: "Enviando", 2: "Enviada", 3: "Entregue", 4: "Lida", 5: "Ouvida" };

/** Tique de entrega das minhas mensagens: ícone + rótulo acessível, não só cor. */
export function AckIcon({ ack }: { ack: number | null }) {
  if (ack === null || !ACK_LABEL[ack]) return null;
  const label = ACK_LABEL[ack];
  const Icon = ack === 1 ? Clock : ack === 2 ? Check : CheckCheck;
  return (
    <span className={`bubble__ack${ack >= 4 ? " bubble__ack--read" : ""}`} title={label}>
      <Icon size={14} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Reações agrupadas por emoji; a minha fica destacada e sai com um clique. */
export function ReactionList({ m, onReact }: { m: Message; onReact: (m: Message, emoji: string) => void }) {
  if (!m.reactions.length) return null;
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const r of m.reactions) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false };
    groups.set(r.emoji, { count: g.count + 1, mine: g.mine || r.fromMe });
  }
  return (
    <ul className="reactions" aria-label="Reações">
      {[...groups].map(([emoji, g]) => (
        <li key={emoji}>
          <button
            type="button"
            className={`reaction${g.mine ? " reaction--mine" : ""}`}
            aria-label={g.mine ? `Tirar sua reação ${emoji}` : `${emoji}, ${g.count} ${g.count === 1 ? "reação" : "reações"}`}
            title={g.mine ? "Tirar sua reação" : undefined}
            disabled={!g.mine}
            onClick={() => onReact(m, "")}
          >
            <span aria-hidden>{emoji}</span>
            {g.count > 1 && <span className="reaction__count">{g.count}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Botão de reagir com o seletor das 6 reações. Esc ou foco fora fecha. */
export function ReactButton({ m, onReact, disabled }: { m: Message; onReact: (m: Message, emoji: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const mine = m.reactions.find((r) => r.fromMe)?.emoji ?? null;
  return (
    <span
      className="react-button"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <button
        type="button"
        className="icon-button icon-button--plain icon-button--small"
        aria-label="Reagir"
        title="Reagir"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <SmilePlus size={16} aria-hidden />
      </button>
      {open && (
        <span className="reaction-picker" role="menu" aria-label="Escolher reação">
          {REACTIONS.map((emoji, i) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              className={`reaction-picker__item${mine === emoji ? " is-selected" : ""}`}
              aria-label={mine === emoji ? `Tirar reação ${emoji}` : `Reagir com ${emoji}`}
              autoFocus={i === 0}
              onClick={() => {
                setOpen(false);
                onReact(m, mine === emoji ? "" : emoji);
              }}
            >
              {emoji}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** Barra acima do campo enquanto uma mensagem minha está sendo editada. */
export function EditBar({ message, onCancel }: { message: Message; onCancel: () => void }) {
  return (
    <div className="reply-bar" role="status">
      <Pencil size={16} aria-hidden />
      <div className="quote quote--static">
        <span className="quote__author">Editando mensagem</span>
        <span className="quote__text">{message.text}</span>
      </div>
      <button type="button" className="icon-button icon-button--plain" aria-label="Cancelar edição" onClick={onCancel}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
