import { Archive, ArchiveRestore, Bell, BellOff, ChevronDown, Clock, FolderCog, Keyboard, MessageSquareText, Pin, PinOff, Tags, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Chat, ChatPatch, SearchHit } from "./api.ts";
import { dayLabel, formatTime, listTime } from "./format.ts";

/** Silenciar "sempre": maior data que o JavaScript representa. */
const FOREVER = 8_640_000_000_000_000;

/** Fecha o painel com clique fora ou Esc (e devolve o foco ao botão). */
function useDismiss(open: boolean, setOpen: (v: boolean) => void, root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, root]);
}

const at = (days: number, h: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, 0, 0, 0);
  return d.getTime();
};

function snoozePresets(): { label: string; at: number }[] {
  const now = new Date();
  const list = [{ label: "Por 1 hora", at: Date.now() + 3600_000 }];
  if (now.getHours() < 17) list.push({ label: "Até hoje 18:00", at: at(0, 18) });
  list.push({ label: "Até amanhã 9:00", at: at(1, 9) });
  // Próxima segunda (se hoje é segunda, a da semana que vem).
  const monday = ((8 - now.getDay()) % 7) || 7;
  list.push({ label: "Até segunda 9:00", at: at(monday, 9) });
  return list;
}

const MUTES = [
  { label: "Por 8 horas", ms: 8 * 3600_000 },
  { label: "Por 1 semana", ms: 7 * 24 * 3600_000 },
  { label: "Sempre", ms: null },
];

export const isMuted = (c: Chat, now = Date.now()) => c.mutedUntil !== null && c.mutedUntil > now;
export const isSnoozed = (c: Chat, now = Date.now()) => c.snoozedUntil !== null && c.snoozedUntil > now;
export const untilLabel = (ms: number) => `${dayLabel(ms)} ${formatTime(ms)}`;

function MenuItem({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="org-menu__item" onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

/** Fixar, arquivar, silenciar e adiar a conversa aberta. */
export function ChatMenu({ chat, onChange }: { chat: Chat; onChange: (patch: ChatPatch) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, root);
  const pick = (patch: ChatPatch) => {
    setOpen(false);
    onChange(patch);
  };
  const muted = isMuted(chat);
  const snoozed = isSnoozed(chat);
  return (
    <div className="org-menu" ref={root}>
      <button type="button" className="button button--secondary button--compact" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FolderCog size={16} aria-hidden /> Organizar
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="org-menu__panel" role="menu" aria-label="Organizar conversa">
          <MenuItem icon={chat.pinnedAt ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />} onClick={() => pick({ pinned: !chat.pinnedAt })}>
            {chat.pinnedAt ? "Desafixar" : "Fixar no topo"}
          </MenuItem>
          <MenuItem icon={chat.archived ? <ArchiveRestore size={16} aria-hidden /> : <Archive size={16} aria-hidden />} onClick={() => pick({ archived: !chat.archived })}>
            {chat.archived ? "Desarquivar" : "Arquivar"}
          </MenuItem>
          <p className="org-menu__label">{muted ? `Silenciada ${chat.mutedUntil! >= FOREVER ? "sempre" : `até ${untilLabel(chat.mutedUntil!)}`}` : "Silenciar notificações"}</p>
          {muted ? (
            <MenuItem icon={<Bell size={16} aria-hidden />} onClick={() => pick({ mutedUntil: null })}>
              Reativar notificações
            </MenuItem>
          ) : (
            MUTES.map((m) => (
              <MenuItem key={m.label} icon={<BellOff size={16} aria-hidden />} onClick={() => pick({ mutedUntil: m.ms === null ? FOREVER : Date.now() + m.ms })}>
                {m.label}
              </MenuItem>
            ))
          )}
          <p className="org-menu__label">{snoozed ? `Adiada até ${untilLabel(chat.snoozedUntil!)}` : "Adiar (some das abertas e volta sozinha)"}</p>
          {snoozed ? (
            <MenuItem icon={<X size={16} aria-hidden />} onClick={() => pick({ snoozedUntil: null })}>
              Cancelar adiamento
            </MenuItem>
          ) : (
            snoozePresets().map((p) => (
              <MenuItem key={p.label} icon={<Clock size={16} aria-hidden />} onClick={() => pick({ snoozedUntil: p.at })}>
                {p.label}
              </MenuItem>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Etiquetas extras da conversa, além da principal. */
export function ExtraLabelsPicker({ chat, labels, onChange }: { chat: Chat; labels: string[]; onChange: (patch: ChatPatch) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, root);
  const options = labels.filter((l) => l !== chat.label);
  if (!options.length) return null;
  const toggle = (label: string) => {
    const has = chat.extraLabels.includes(label);
    onChange({ extraLabels: has ? chat.extraLabels.filter((l) => l !== label) : [...chat.extraLabels, label] });
  };
  return (
    <div className="org-menu" ref={root}>
      <button
        type="button"
        className="button button--secondary button--compact"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Etiquetas extras desta conversa"
        onClick={() => setOpen((v) => !v)}
      >
        <Tags size={16} aria-hidden />
        {chat.extraLabels.length ? `+${chat.extraLabels.length} etiqueta${chat.extraLabels.length > 1 ? "s" : ""}` : "Mais etiquetas"}
      </button>
      {open && (
        <div className="org-menu__panel" role="dialog" aria-label="Etiquetas extras">
          <p className="org-menu__label">Além da etiqueta principal</p>
          {options.map((l) => (
            <label key={l} className="check org-menu__check">
              <input type="checkbox" checked={chat.extraLabels.includes(l)} onChange={() => toggle(l)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Trecho achado: o servidor marca o termo entre \u0002 e \u0003. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("\u0002") ? <mark key={i}>{p.slice(1, -1)}</mark> : p))}
    </>
  );
}

/** Mensagens achadas na busca, abaixo das conversas. */
export function MessageHits({ hits, chats, loading, onOpen }: {
  hits: SearchHit[];
  chats: Map<string, Chat>;
  loading: boolean;
  onOpen: (jid: string, id: string) => void;
}) {
  const list = hits.filter((h) => chats.has(h.chatJid));
  return (
    <section className="message-hits" aria-label="Mensagens encontradas" aria-busy={loading || undefined}>
      <h2 className="eyebrow message-hits__title">
        <MessageSquareText size={14} aria-hidden /> Mensagens {list.length ? `(${list.length}${hits.length >= 50 ? "+" : ""})` : ""}
      </h2>
      {!list.length ? (
        <p className="hint message-hits__empty">{loading ? "Buscando no histórico…" : "Nenhuma mensagem com esse texto."}</p>
      ) : (
        <ul className="chat-list">
          {list.map((h) => (
            <li key={`${h.chatJid}/${h.id}`}>
              <button type="button" className="chat-item message-hit" onClick={() => onOpen(h.chatJid, h.id)}>
                <span className="chat-item__body">
                  <span className="chat-item__row">
                    <span className="chat-item__name">{chats.get(h.chatJid)!.name}</span>
                    <span className="chat-item__time">{listTime(h.at)}</span>
                  </span>
                  <span className="message-hit__snippet">
                    {h.fromMe && <span className="chat-item__me">Você: </span>}
                    <Snippet text={h.snippet} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl + K", "Buscar conversas e mensagens"],
  ["Alt + ↓ / Alt + ↑", "Próxima / conversa anterior da lista"],
  ["Ctrl + Enter", "Marcar como resolvida (fora do campo de mensagem)"],
  ["Esc", "Fechar painel, cancelar resposta ou edição"],
  ["/", "Respostas rápidas (no começo do campo)"],
  ["@", "Mencionar em grupo"],
  ["Ctrl + B / I", "Negrito / itálico no texto"],
  ["?", "Esta lista de atalhos"],
];

/** Lista de atalhos de teclado. Fecha por X, Esc ou clique fora. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        if (e.key === "Escape") onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal">
      <div className="modal__overlay" onClick={onClose} />
      <div className="modal__panel surface shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className="shortcuts__head">
          <h2 id="shortcuts-title" className="heading-card">
            <Keyboard size={18} aria-hidden /> Atalhos de teclado
          </h2>
          <button ref={close} type="button" className="icon-button icon-button--plain" aria-label="Fechar" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <dl className="shortcuts__list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="shortcuts__row">
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Rascunho por conversa, só neste computador: sobrevive a trocar de conversa e reiniciar. */
export const drafts = {
  key: (jid: string) => `inbox:draft:${jid}`,
  get(jid: string): string {
    try {
      return localStorage.getItem(this.key(jid)) ?? "";
    } catch {
      return "";
    }
  },
  set(jid: string, text: string) {
    try {
      if (text.trim()) localStorage.setItem(this.key(jid), text);
      else localStorage.removeItem(this.key(jid));
    } catch {
      // armazenamento indisponível: o rascunho vale só enquanto a conversa estiver aberta
    }
  },
};
