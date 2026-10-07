import { Copy, Download, Forward, Pencil, Reply, Trash2, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { mediaUrl, type Message } from "./api.ts";
import { canEdit, REACTIONS } from "./message-extras.tsx";

/** Mensagem e ponto da tela onde o menu abre (clique direito ou botão "Mais opções"). */
export type MenuAt = { message: Message; x: number; y: number };

export type MessageMenuActions = {
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onCopy: (m: Message) => void;
  onForward: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onAuthor: (jid: string, name: string) => void;
};

type Item = { id: string; label: string; icon: ReactNode; danger?: boolean; disabled?: boolean; href?: string; run?: () => void };

/** Menu de contexto da mensagem, com as ações do WhatsApp. Fecha com Esc, clique fora ou rolagem. */
export function MessageMenu({ at, canAct, hasText, author, actions, onClose }: {
  at: MenuAt;
  /** WhatsApp conectado: responder, reagir, encaminhar e editar dependem dele. */
  canAct: boolean;
  /** Tem texto ou legenda para copiar. */
  hasText: boolean;
  /** Autor em grupo (mensagem de outra pessoa). */
  author: { jid: string; name: string } | null;
  actions: MessageMenuActions;
  onClose: () => void;
}) {
  const m = at.message;
  const mine = m.reactions.find((r) => r.fromMe)?.emoji ?? null;
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  const items: Item[] = m.deleted
    ? [{ id: "delete", label: "Apagar", icon: <Trash2 size={16} aria-hidden />, danger: true, run: () => actions.onDelete(m) }]
    : [
        { id: "reply", label: "Responder", icon: <Reply size={16} aria-hidden />, disabled: !canAct, run: () => actions.onReply(m) },
        ...(hasText ? [{ id: "copy", label: "Copiar", icon: <Copy size={16} aria-hidden />, run: () => actions.onCopy(m) }] : []),
        { id: "forward", label: "Encaminhar", icon: <Forward size={16} aria-hidden />, disabled: !canAct, run: () => actions.onForward(m) },
        ...(m.media ? [{ id: "download", label: "Baixar arquivo", icon: <Download size={16} aria-hidden />, href: mediaUrl(m, true) }] : []),
        ...(canEdit(m) ? [{ id: "edit", label: "Editar", icon: <Pencil size={16} aria-hidden />, disabled: !canAct, run: () => actions.onEdit(m) }] : []),
        ...(author ? [{ id: "author", label: `Ver perfil de ${author.name}`, icon: <UserRound size={16} aria-hidden />, run: () => actions.onAuthor(author.jid, author.name) }] : []),
        { id: "delete", label: "Apagar", icon: <Trash2 size={16} aria-hidden />, danger: true, run: () => actions.onDelete(m) },
      ];

  // Cabe na tela: abre para cima/esquerda quando falta espaço.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 8;
    setPos({
      left: Math.max(gap, Math.min(at.x, window.innerWidth - width - gap)),
      top: Math.max(gap, at.y + height + gap > window.innerHeight ? at.y - height : at.y),
    });
    el.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [at]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => !panel.current?.contains(e.target as Node) && onClose();
    const onScroll = (e: Event) => !panel.current?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = [...(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      go(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(i - 1);
    } else if (e.key === "ArrowRight" && list[i]?.dataset.emoji) {
      e.preventDefault();
      go(i + 1);
    } else if (e.key === "ArrowLeft" && list[i]?.dataset.emoji) {
      e.preventDefault();
      go(i - 1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      go(e.key === "Home" ? 0 : list.length - 1);
    }
  };

  const pick = (run?: () => void) => {
    onClose();
    run?.();
  };

  return (
    <div ref={panel} className="message-menu" role="menu" aria-label="Opções da mensagem" style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {!m.deleted && (
        <div className="message-menu__reactions" role="group" aria-label="Reagir">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              data-emoji
              className="message-menu__emoji"
              aria-label={mine === emoji ? `Tirar reação ${emoji}` : `Reagir com ${emoji}`}
              aria-pressed={mine === emoji || undefined}
              disabled={!canAct}
              onClick={() => pick(() => actions.onReact(m, mine === emoji ? "" : emoji))}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {items.map((item) =>
        item.href ? (
          <a key={item.id} role="menuitem" className="message-menu__item" href={item.href} download onClick={() => onClose()}>
            {item.icon}
            {item.label}
          </a>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`message-menu__item${item.danger ? " message-menu__item--danger" : ""}`}
            disabled={item.disabled}
            onClick={() => pick(item.run)}
          >
            {item.icon}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
