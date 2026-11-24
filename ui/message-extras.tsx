import { Check, CheckCheck, Clock, Copy, Pencil, Plus, SmilePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmojiPicker, rememberEmoji } from "./emoji.tsx";
import type { Message } from "./api.ts";
import { Button } from "./ds/index.ts";

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

/** "Ana", "Ana e Bruno", "Ana, Bruno e Você". */
const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);

/**
 * Reações agrupadas por emoji; a minha fica destacada. Passar o mouse mostra quem reagiu;
 * clicar abre a lista de quem reagiu com o quê, e ali a minha sai com um clique, como no WhatsApp.
 */
export function ReactionList({ m, onReact }: { m: Message; onReact: (m: Message, emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!m.reactions.length) return null;
  const groups = new Map<string, { names: string[]; mine: boolean }>();
  for (const r of m.reactions) {
    const g = groups.get(r.emoji) ?? { names: [], mine: false };
    groups.set(r.emoji, { names: [...g.names, r.name], mine: g.mine || r.fromMe });
  }
  // Minha reação primeiro, depois na ordem em que chegaram.
  const people = [...m.reactions].sort((a, b) => Number(b.fromMe) - Number(a.fromMe));
  return (
    <div
      className="reactions-wrap"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <ul className="reactions" aria-label="Reações">
        {[...groups].map(([emoji, g]) => (
          <li key={emoji}>
            <button
              type="button"
              className={`reaction${g.mine ? " reaction--mine" : ""}`}
              aria-label={`${emoji}: ${joinNames(g.names)}. Ver quem reagiu`}
              aria-expanded={open}
              title={joinNames(g.names)}
              onClick={() => setOpen((v) => !v)}
            >
              <span aria-hidden>{emoji}</span>
              {g.names.length > 1 && <span className="reaction__count">{g.names.length}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="reactors" role="dialog" aria-label={`${m.reactions.length} ${m.reactions.length === 1 ? "reação" : "reações"}`}>
          <ul className="reactors__list">
            {people.map((r, i) => (
              <li key={`${r.name}-${i}`} className="reactors__item">
                {r.fromMe ? (
                  <button
                    type="button"
                    className="reactors__row reactors__row--mine"
                    autoFocus
                    onClick={() => {
                      setOpen(false);
                      onReact(m, "");
                    }}
                  >
                    <span className="reactors__name">
                      Você
                      <span className="reactors__hint">Clique para remover</span>
                    </span>
                    <span className="reactors__emoji" aria-hidden>{r.emoji}</span>
                  </button>
                ) : (
                  <span className="reactors__row">
                    <span className="reactors__name">{r.name}</span>
                    <span className="reactors__emoji">{r.emoji}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Copiar com confirmação no próprio botão: o ícone vira um tique por um instante, sem toast. */
export function CopyButton({ m, onCopy }: { m: Message; onCopy: (m: Message, quiet?: boolean) => Promise<boolean> }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`icon-button icon-button--plain icon-button--small copy-button${done ? " is-done" : ""}`}
      aria-label={done ? "Texto copiado" : "Copiar texto"}
      title={done ? "Copiado" : "Copiar texto"}
      onClick={async () => {
        if (!(await onCopy(m, true))) return;
        setDone(true);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1400);
      }}
    >
      <Copy className="copy-button__icon copy-button__icon--copy" size={16} aria-hidden />
      <Check className="copy-button__icon copy-button__icon--check" size={16} aria-hidden />
      <span className="sr-only" aria-live="polite">{done ? "Texto copiado" : ""}</span>
    </button>
  );
}

/** Botão de reagir com o seletor das 6 reações; o "+" abre o painel completo de emojis. Esc ou foco fora fecha. */
export function ReactButton({ m, onReact, disabled }: { m: Message; onReact: (m: Message, emoji: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const mine = m.reactions.find((r) => r.fromMe)?.emoji ?? null;
  const close = () => {
    setOpen(false);
    setMore(false);
  };
  const react = (emoji: string) => {
    close();
    onReact(m, mine === emoji ? "" : emoji);
  };
  return (
    <span
      className="react-button"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}
      onKeyDown={(e) => {
        // Esc com texto na busca de emojis só limpa (a busca já tratou a tecla).
        if (e.key === "Escape" && !e.defaultPrevented) close();
      }}
    >
      <button
        type="button"
        className="icon-button icon-button--plain icon-button--small"
        aria-label="Reagir"
        title="Reagir"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <SmilePlus size={16} aria-hidden />
      </button>
      {open && !more && (
        <span className="reaction-picker" role="menu" aria-label="Escolher reação">
          {REACTIONS.map((emoji, i) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              className={`reaction-picker__item${mine === emoji ? " is-selected" : ""}`}
              aria-label={mine === emoji ? `Tirar reação ${emoji}` : `Reagir com ${emoji}`}
              autoFocus={i === 0}
              onClick={() => react(emoji)}
            >
              {emoji}
            </button>
          ))}
          <button type="button" role="menuitem" className="reaction-picker__item reaction-picker__more" aria-label="Mais emojis" title="Mais emojis" onClick={() => setMore(true)}>
            <Plus size={16} aria-hidden />
          </button>
        </span>
      )}
      {open && more && (
        <EmojiPicker
          onPick={(emoji) => {
            rememberEmoji(emoji);
            react(emoji);
          }}
          onClose={close}
        />
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
      <Button variant="ghost" size="compact" icon={<X size={16} aria-hidden />} aria-label="Cancelar edição" onClick={onCancel} />
    </div>
  );
}
