import { CheckSquare, ChevronLeft, Copy, Download, Eye, Forward, ImageIcon, MessageCircleReply, Pencil, Pin, PinOff, Reply, Star, StarOff, Trash2, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { mediaUrl, type Message } from "./api.ts";
import { canEdit, REACTIONS } from "./message-extras.tsx";
import { canCopyMedia } from "./media.tsx";

/** Mensagem e ponto da tela onde o menu abre (clique direito ou botão "Mais opções"). */
export type MenuAt = { message: Message; x: number; y: number };

export type MessageMenuActions = {
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onCopy: (m: Message) => void;
  /** Imagem como imagem; outros arquivos como arquivo (colar no Explorer, e-mail etc.). */
  onCopyMedia: (m: Message) => void;
  /** Abre a visualização dentro do app, sem baixar. */
  onView: (m: Message) => void;
  onForward: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onAuthor: (jid: string, name: string) => void;
  onStar: (m: Message) => void;
  /** Fixar por `seconds` ou desafixar (null). */
  onPin: (m: Message, seconds: number | null) => void;
  /** Responder em particular a quem escreveu no grupo. */
  onPrivateReply: (m: Message) => void;
  /** Entra no modo de seleção com esta mensagem marcada. */
  onSelect: (m: Message) => void;
};

/** Prazos que o WhatsApp oferece para fixar. */
const PIN_TIMES = [
  { label: "24 horas", seconds: 86400 },
  { label: "7 dias", seconds: 604800 },
  { label: "30 dias", seconds: 2592000 },
];

/** `keep`: não fecha o menu (troca de submenu); `sub`: abre submenu. */
type Item = { id: string; label: string; icon: ReactNode; danger?: boolean; disabled?: boolean; href?: string; keep?: boolean; sub?: boolean; run?: () => void };

/** Menu de contexto da mensagem, com as ações do WhatsApp. Fecha com Esc, clique fora ou rolagem. */
export function MessageMenu({ at, canAct, hasText, author, pinned, canPrivateReply, actions, onClose }: {
  /** Mensagem já fixada na conversa. */
  pinned: boolean;
  canPrivateReply: boolean;
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
  const image = m.media?.type === "image" || m.media?.type === "sticker";
  const viewable = image || m.media?.type === "document";
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const [view, setView] = useState<"main" | "pin">("main");
  const call = m.kind === "call";

  const items: Item[] = m.deleted
    ? [{ id: "delete", label: "Apagar", icon: <Trash2 size={16} aria-hidden />, danger: true, run: () => actions.onDelete(m) }]
    : view === "pin"
      ? [
          { id: "back", label: "Fixar por quanto tempo?", icon: <ChevronLeft size={16} aria-hidden />, keep: true, run: () => setView("main") },
          ...PIN_TIMES.map((t) => ({ id: `pin-${t.seconds}`, label: t.label, icon: <Pin size={16} aria-hidden />, disabled: !canAct, run: () => actions.onPin(m, t.seconds) })),
        ]
    : [
        ...(call ? [] : [{ id: "reply", label: "Responder", icon: <Reply size={16} aria-hidden />, disabled: !canAct, run: () => actions.onReply(m) }]),
        ...(canPrivateReply ? [{ id: "private", label: "Responder em particular", icon: <MessageCircleReply size={16} aria-hidden />, disabled: !canAct, run: () => actions.onPrivateReply(m) }] : []),
        ...(hasText ? [{ id: "copy", label: "Copiar", icon: <Copy size={16} aria-hidden />, run: () => actions.onCopy(m) }] : []),
        ...(m.media && canCopyMedia(m)
          ? [{ id: "copy-media", label: image ? "Copiar imagem" : "Copiar arquivo", icon: image ? <ImageIcon size={16} aria-hidden /> : <Copy size={16} aria-hidden />, run: () => actions.onCopyMedia(m) }]
          : []),
        ...(viewable ? [{ id: "view", label: "Visualizar", icon: <Eye size={16} aria-hidden />, run: () => actions.onView(m) }] : []),
        ...(call ? [] : [{ id: "forward", label: "Encaminhar", icon: <Forward size={16} aria-hidden />, disabled: !canAct, run: () => actions.onForward(m) }]),
        { id: "star", label: m.starred ? "Desfavoritar" : "Favoritar", icon: m.starred ? <StarOff size={16} aria-hidden /> : <Star size={16} aria-hidden />, run: () => actions.onStar(m) },
        ...(call
          ? []
          : pinned
            ? [{ id: "unpin", label: "Desafixar", icon: <PinOff size={16} aria-hidden />, disabled: !canAct, run: () => actions.onPin(m, null) }]
            : [{ id: "pin", label: "Fixar", icon: <Pin size={16} aria-hidden />, disabled: !canAct, keep: true, sub: true, run: () => setView("pin") }]),
        ...(m.media ? [{ id: "download", label: "Baixar arquivo", icon: <Download size={16} aria-hidden />, href: mediaUrl(m, true) }] : []),
        ...(canEdit(m) ? [{ id: "edit", label: "Editar", icon: <Pencil size={16} aria-hidden />, disabled: !canAct, run: () => actions.onEdit(m) }] : []),
        { id: "select", label: "Selecionar mensagens", icon: <CheckSquare size={16} aria-hidden />, run: () => actions.onSelect(m) },
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
  }, [at, view]);

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
    <div ref={panel} className="bt-menu__panel ctx-menu" role="menu" aria-label="Opções da mensagem" style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {!m.deleted && !call && view === "main" && (
        <div className="ctx-menu__reactions" role="group" aria-label="Reagir">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              data-emoji
              className="ctx-menu__emoji"
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
          <a key={item.id} role="menuitem" className="bt-menu__item" href={item.href} download onClick={() => setTimeout(onClose)}>
            <span className="bt-menu__icon">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`bt-menu__item${item.danger ? " bt-menu__item--danger" : ""}${item.id === "back" ? " ctx-menu__back" : ""}`}
            disabled={item.disabled}
            aria-haspopup={item.sub ? "menu" : undefined}
            onClick={() => (item.keep ? item.run?.() : pick(item.run))}
          >
            <span className="bt-menu__icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
