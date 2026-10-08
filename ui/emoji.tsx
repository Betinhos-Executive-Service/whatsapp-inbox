import { Car, Clock, Coffee, Flag, Heart, Lightbulb, PawPrint, Smile, Trophy, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Emoji, EmojiCategory } from "./emoji-data.ts";
import { pushRecent, searchEmoji } from "./emoji-text.ts";
import { Button, SearchBox } from "./ds/index.ts";

export { convertEmoticon, emojiQuery, insertAt, insertEmojiShortcut, searchEmoji, undoEmoticon, type EmoticonSwap } from "./emoji-text.ts";

type EmojiData = typeof import("./emoji-data.ts");
let data: EmojiData | null = null;
let loading: Promise<EmojiData> | null = null;

/** O catálogo (~1.900 emojis) é um pedaço à parte, carregado no primeiro ":" ou na primeira abertura do painel. */
export function useEmojiData(need: boolean): EmojiData | null {
  const [loaded, setLoaded] = useState(data);
  useEffect(() => {
    if (!need || loaded) return;
    let alive = true;
    loading ??= import("./emoji-data.ts").then((m) => (data = m));
    loading.then((m) => alive && setLoaded(m), () => (loading = null));
    return () => {
      alive = false;
    };
  }, [need, loaded]);
  return loaded;
}

const RECENT_KEY = "inbox:emoji-recentes";
const COLUMNS = 8;
const ICONS: Record<EmojiCategory | "recentes", LucideIcon> = {
  recentes: Clock, pessoas: Smile, natureza: PawPrint, comida: Coffee, atividades: Trophy,
  viagem: Car, objetos: Lightbulb, simbolos: Heart, bandeiras: Flag,
};

function loadRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Guarda o emoji entre os recentes do seletor (o atalho ":texto" também conta). */
export function rememberEmoji(emoji: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(loadRecent(), emoji)));
  } catch {
    // sem armazenamento: o seletor só não lembra os recentes
  }
}

/** Sugestões do atalho ":texto", na mesma lista das respostas rápidas e menções. */
export function EmojiShortcutMenu({ items, active, onPick, onHover }: {
  items: Emoji[];
  active: number;
  onPick: (e: Emoji) => void;
  onHover: (i: number) => void;
}) {
  return (
    <ul className="quick-menu" role="listbox" id="emoji-menu" aria-label="Emojis">
      {items.map((e, i) => (
        <li
          key={e.char}
          id={`emoji-${i}`}
          role="option"
          aria-selected={i === active}
          className="quick-menu__item emoji-item"
          // mousedown para não tirar o foco do campo antes de escolher
          onMouseDown={(ev) => {
            ev.preventDefault();
            onPick(e);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="emoji-item__char" aria-hidden>{e.char}</span>
          <span className="quick-menu__text">{e.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Painel de emojis acima do campo, como o do WhatsApp: busca, abas por categoria e recentes.
 * Fica aberto enquanto escolhe; Esc ou clique fora fecha.
 */
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [recent] = useState(loadRecent);
  const [active, setActive] = useState<EmojiCategory | "recentes">(recent.length ? "recentes" : "pessoas");
  const body = useRef<HTMLDivElement>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  const catalog = useEmojiData(true);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const byChar = new Map(catalog.EMOJIS.map((e) => [e.char, e]));
    const recentList = recent.map((c) => byChar.get(c) ?? { char: c, name: c, keys: [], category: "pessoas" as const });
    return [
      ...(recentList.length ? [{ id: "recentes" as const, label: "Recentes", items: recentList }] : []),
      ...catalog.EMOJI_CATEGORIES.map((c) => ({ ...c, items: catalog.EMOJIS.filter((e) => e.category === c.id) })),
    ];
  }, [catalog, recent]);
  const results = catalog && search.trim() ? searchEmoji(search, catalog.EMOJIS) : null;

  const pick = (e: Emoji) => {
    onPick(e.char);
    rememberEmoji(e.char);
    // Os recentes só reordenam na próxima abertura: a grade não pula sob o ponteiro.
  };

  const jump = (id: EmojiCategory | "recentes") => {
    setSearch("");
    setActive(id);
    requestAnimationFrame(() => {
      const el = sections.current.get(id);
      if (el && body.current) body.current.scrollTop = el.offsetTop - body.current.offsetTop;
    });
  };
  // A aba acompanha a seção visível ao rolar.
  const onScroll = () => {
    if (!body.current || results || !groups.length) return;
    const top = body.current.scrollTop + body.current.offsetTop + 8;
    let current: EmojiCategory | "recentes" = groups[0].id;
    for (const g of groups) {
      const el = sections.current.get(g.id);
      if (el && el.offsetTop <= top) current = g.id;
    }
    setActive(current);
  };

  // Setas andam pela grade; ↑ na primeira linha volta para a busca.
  const gridKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (!step || !body.current) return;
    const cells = [...body.current.querySelectorAll<HTMLButtonElement>(".emoji-picker__cell")];
    const i = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = i + step;
    if (next < 0) body.current.closest(".emoji-picker")?.querySelector<HTMLInputElement>("input")?.focus();
    else cells[Math.min(next, cells.length - 1)]?.focus();
  };
  const searchKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      body.current?.querySelector<HTMLButtonElement>(".emoji-picker__cell")?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results?.[0]) pick(results[0]);
    } else if (e.key === "Escape" && !search) {
      e.preventDefault();
      onClose();
    }
  };

  const cell = (e: Emoji, first: boolean) => (
    <button
      key={e.char}
      type="button"
      className="emoji-picker__cell"
      title={e.name}
      aria-label={e.name}
      tabIndex={first ? 0 : -1}
      // mousedown sem foco: o cursor do campo e o painel ficam onde estão
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={() => pick(e)}
    >
      {e.char}
    </button>
  );

  return (
    <div className="emoji-picker" role="dialog" aria-label="Emojis">
      <nav className="emoji-picker__tabs" aria-label="Categorias de emoji">
        {groups.map((g) => {
          const Icon = ICONS[g.id];
          return (
            <button
              key={g.id}
              type="button"
              className="emoji-picker__tab"
              aria-label={g.label}
              title={g.label}
              aria-current={!results && active === g.id ? "true" : undefined}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => jump(g.id)}
            >
              <Icon size={18} aria-hidden />
            </button>
          );
        })}
      </nav>
      <SearchBox
        className="emoji-picker__search"
        size="compact"
        value={search}
        onChange={setSearch}
        aria-label="Buscar emoji"
        placeholder="Buscar emoji"
        autoFocus={matchMedia("(pointer: fine)").matches}
        onKeyDown={searchKeys}
      />
      <div className="emoji-picker__body" ref={body} onScroll={onScroll} onKeyDown={gridKeys}>
        {!catalog && <p className="emoji-picker__empty">Carregando emojis…</p>}
        {results ? (
          results.length ? (
            <div className="emoji-picker__grid" role="group" aria-label="Resultados">
              {results.map((e, i) => cell(e, i === 0))}
            </div>
          ) : (
            <p className="emoji-picker__empty">Nenhum emoji encontrado para “{search.trim()}”.</p>
          )
        ) : (
          groups.map((g, gi) => (
            <section
              key={g.id}
              ref={(el) => {
                if (el) sections.current.set(g.id, el);
                else sections.current.delete(g.id);
              }}
              aria-label={g.label}
            >
              <h3 className="emoji-picker__heading">{g.label}</h3>
              <div className="emoji-picker__grid">{g.items.map((e, i) => cell(e, gi === 0 && i === 0))}</div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** Botão do compositor que abre o painel. O painel fecha ao sair o foco (clique fora) ou com Esc. */
export function EmojiButton({ disabled, onPick, onClose }: { disabled: boolean; onPick: (emoji: string) => void; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClose();
  };
  return (
    <span
      className="emoji-button"
      onBlur={(e) => open && !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      onKeyDown={(e) => {
        // Esc com texto na busca só limpa (a busca já tratou a tecla).
        if (e.key === "Escape" && open && !e.defaultPrevented) {
          e.preventDefault();
          close();
        }
      }}
    >
      <Button
        variant="ghost"
        aria-label="Emojis"
        title="Emojis (ou digite : e o nome, como :joinha)"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        icon={<Smile size={18} aria-hidden />}
      />
      {open && <EmojiPicker onPick={onPick} onClose={close} />}
    </span>
  );
}
