import { Archive, ArchiveRestore, AudioLines, Bell, BellOff, Check, ChevronLeft, ChevronRight, Clock, Keyboard, MessageSquareText, Pin, PinOff, Tags, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Chat, ChatPatch, SearchHit } from "./api.ts";
import { dayLabel, formatTime, listTime } from "./format.ts";
import { Button, Dialog, Select } from "./ds/index.ts";

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

type View = "main" | "mute" | "transcribe" | "snooze";

function MenuItem({ icon, children, onClick, hint, checked }: { icon: ReactNode; children: ReactNode; onClick: () => void; hint?: string; checked?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} className="bt-menu__item" onClick={onClick}>
      <span className="bt-menu__icon">{icon}</span>
      <span className="ctx-menu__text">{children}</span>
      {hint && <span className="ctx-menu__hint">{hint}</span>}
    </button>
  );
}

/** Abre um submenu no lugar do menu principal: rótulo, estado atual à direita e seta. */
function SubmenuItem({ icon, children, hint, onOpen }: { icon: ReactNode; children: ReactNode; hint?: string; onOpen: () => void }) {
  return (
    <button type="button" role="menuitem" aria-haspopup="menu" className="bt-menu__item" data-sub onClick={onOpen}>
      <span className="bt-menu__icon">{icon}</span>
      <span className="ctx-menu__text">{children}</span>
      {hint && <span className="ctx-menu__hint">{hint}</span>}
      <ChevronRight size={14} aria-hidden className="ctx-menu__chevron" />
    </button>
  );
}

const TRANSCRIBE = [
  [null, "Seguir a configuração geral"],
  ["on", "Sempre nesta conversa"],
  ["off", "Nunca nesta conversa"],
] as const;

/** Clique direito numa conversa da lista: fixar, arquivar, silenciar, adiar e transcrever, sem abrir a conversa. Fecha com Esc, clique fora ou rolagem. */
export function ChatItemMenu({ chat, x, y, onChange, onClose }: { chat: Chat; x: number; y: number; onChange: (patch: ChatPatch) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("main");
  const [pos, setPos] = useState({ left: x, top: y });
  const muted = isMuted(chat);
  const snoozed = isSnoozed(chat);

  // Cabe na tela: encosta na borda quando falta espaço. Refaz ao trocar de submenu.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 8;
    setPos({
      left: Math.max(gap, Math.min(x, window.innerWidth - width - gap)),
      top: Math.max(gap, Math.min(y, window.innerHeight - height - gap)),
    });
    el.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
  }, [x, y, view]);

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

  const pick = (patch: ChatPatch) => {
    onClose();
    onChange(patch);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = [...(panel.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === "Escape" || (e.key === "ArrowLeft" && view !== "main")) {
      e.preventDefault();
      if (view !== "main") setView("main");
      else onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowRight" && list[i]?.dataset.sub !== undefined) {
      e.preventDefault();
      list[i].click();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      go(i + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      go(e.key === "Home" ? 0 : list.length - 1);
    }
  };

  const back = (title: string) => (
    <button type="button" role="menuitem" className="bt-menu__item ctx-menu__back" onClick={() => setView("main")}>
      <span className="bt-menu__icon"><ChevronLeft size={16} aria-hidden /></span>
      <span className="ctx-menu__text">{title}</span>
    </button>
  );

  return (
    <div
      ref={panel}
      className="bt-menu__panel ctx-menu ctx-menu--chat"
      role="menu"
      aria-label={`Organizar ${chat.name}`}
      style={pos}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {view === "main" && (
        <>
          <p className="ctx-menu__title" aria-hidden>
            {chat.name}
          </p>
          <MenuItem icon={chat.pinnedAt ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />} onClick={() => pick({ pinned: !chat.pinnedAt })}>
            {chat.pinnedAt ? "Desafixar" : "Fixar no topo"}
          </MenuItem>
          <MenuItem icon={chat.archived ? <ArchiveRestore size={16} aria-hidden /> : <Archive size={16} aria-hidden />} onClick={() => pick({ archived: !chat.archived })}>
            {chat.archived ? "Desarquivar" : "Arquivar"}
          </MenuItem>
          <span className="ctx-menu__sep" role="separator" />
          {muted ? (
            <MenuItem icon={<Bell size={16} aria-hidden />} hint={chat.mutedUntil! >= FOREVER ? "sempre" : `até ${untilLabel(chat.mutedUntil!)}`} onClick={() => pick({ mutedUntil: null })}>
              Reativar notificações
            </MenuItem>
          ) : (
            <SubmenuItem icon={<BellOff size={16} aria-hidden />} onOpen={() => setView("mute")}>
              Silenciar
            </SubmenuItem>
          )}
          {snoozed ? (
            <MenuItem icon={<X size={16} aria-hidden />} hint={`até ${untilLabel(chat.snoozedUntil!)}`} onClick={() => pick({ snoozedUntil: null })}>
              Cancelar adiamento
            </MenuItem>
          ) : (
            <SubmenuItem icon={<Clock size={16} aria-hidden />} onOpen={() => setView("snooze")}>
              Adiar
            </SubmenuItem>
          )}
          <SubmenuItem
            icon={<AudioLines size={16} aria-hidden />}
            hint={chat.autoTranscribe === "on" ? "sempre" : chat.autoTranscribe === "off" ? "nunca" : "padrão"}
            onOpen={() => setView("transcribe")}
          >
            Transcrever áudios
          </SubmenuItem>
        </>
      )}
      {view === "mute" && (
        <>
          {back("Silenciar notificações")}
          {MUTES.map((m) => (
            <MenuItem key={m.label} icon={<BellOff size={16} aria-hidden />} onClick={() => pick({ mutedUntil: m.ms === null ? FOREVER : Date.now() + m.ms })}>
              {m.label}
            </MenuItem>
          ))}
        </>
      )}
      {view === "snooze" && (
        <>
          {back("Adiar conversa")}
          <p className="ctx-menu__note">Sai das abertas e volta sozinha.</p>
          {snoozePresets().map((p) => (
            <MenuItem key={p.label} icon={<Clock size={16} aria-hidden />} onClick={() => pick({ snoozedUntil: p.at })}>
              {p.label}
            </MenuItem>
          ))}
        </>
      )}
      {view === "transcribe" && (
        <>
          {back("Transcrever áudios recebidos")}
          {TRANSCRIBE.map(([value, label]) => (
            <MenuItem
              key={label}
              checked={chat.autoTranscribe === value}
              icon={chat.autoTranscribe === value ? <Check size={16} aria-hidden /> : <span className="ctx-menu__blank" aria-hidden />}
              onClick={() => pick({ autoTranscribe: value })}
            >
              {label}
            </MenuItem>
          ))}
        </>
      )}
    </div>
  );
}

/** Etiquetas extras da conversa, além da principal. */
export function ExtraLabelsPicker({ chat, labels, onChange }: { chat: Chat; labels: string[]; onChange: (patch: ChatPatch) => void }) {
  const options = labels.filter((l) => l !== chat.label);
  if (!options.length) return null;
  return (
    <Select
      multiple
      size="compact"
      searchable={options.length > 8}
      aria-label="Etiquetas extras desta conversa"
      placeholder="Mais etiquetas"
      options={options.map((l) => ({ value: l, label: l }))}
      value={chat.extraLabels.filter((l) => options.includes(l))}
      onChange={(extraLabels) => onChange({ extraLabels })}
    />
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
  ["Ctrl + F", "Pesquisar na conversa aberta (Enter / Shift+Enter navegam)"],
  ["Alt + ↓ / Alt + ↑", "Próxima / conversa anterior da lista"],
  ["Ctrl + Enter", "Marcar como resolvida (fora do campo de mensagem)"],
  ["Ctrl + E", "Arquivar ou desarquivar a conversa aberta"],
  ["Esc", "Fechar painel, cancelar resposta ou edição"],
  ["Botão direito / Shift + F10", "Organizar a conversa da lista: fixar, arquivar, silenciar, adiar"],
  ["/", "Respostas rápidas (no começo do campo)"],
  ["@", "Mencionar em grupo"],
  ["Ctrl + B / I", "Negrito / itálico no texto"],
  ["?", "Esta lista de atalhos"],
];

/** Lista de atalhos de teclado. Fecha por X, Esc ou clique fora. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          <Keyboard size={18} aria-hidden /> Atalhos de teclado
        </>
      }
    >
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
    </Dialog>
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
