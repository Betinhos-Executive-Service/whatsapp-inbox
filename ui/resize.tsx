import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

/** Largura arrastável de um painel, guardada no localStorage e aplicada como variável CSS no :root. */
type Props = {
  /** Variável CSS que o layout lê (ex.: `--inbox-list-w`). */
  cssVar: string;
  storageKey: string;
  initial: number;
  min: number;
  max: number;
  /** Lado do painel em que fica a alça: `end` = borda direita (lista), `start` = borda esquerda (painel lateral). */
  edge: "start" | "end";
  /** Largura mínima que a conversa deve manter ao lado dos painéis. */
  reserve: number;
  label: string;
};

const STEP = 16;
/** Painéis de largura fixa que dividem a tela com a conversa. */
const FIXED_PANES = ".list-pane, .notes";
const root = () => document.documentElement;

function read(key: string, fallback: number) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

export function ResizeHandle({ cssVar, storageKey, initial, min, max, edge, reserve, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; w: number } | null>(null);

  const pane = () => ref.current?.parentElement ?? null;
  // Não deixa a conversa ficar mais estreita que `reserve`.
  const clamp = (w: number) => {
    const el = pane();
    const app = el?.closest(".app");
    let limit = max;
    if (el && app) {
      let fixed = 0;
      app.querySelectorAll<HTMLElement>(FIXED_PANES).forEach((p) => p !== el && (fixed += p.offsetWidth));
      limit = Math.min(max, app.clientWidth - fixed - reserve);
    }
    return Math.round(Math.min(Math.max(w, min), Math.max(min, limit)));
  };
  const apply = (w: number) => {
    root().style.setProperty(cssVar, `${w}px`);
    ref.current?.setAttribute("aria-valuenow", String(w));
  };
  const save = (w: number) => {
    try {
      localStorage.setItem(storageKey, String(w));
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  };

  useEffect(() => apply(Math.min(Math.max(read(storageKey, initial), min), max)), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current || e.button !== 0) return; // ignora segundo dedo/botão
    const el = pane();
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, w: el.offsetWidth };
    document.body.classList.add("is-resizing");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    apply(clamp(edge === "end" ? d.w + dx : d.w - dx));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    document.body.classList.remove("is-resizing");
    const w = pane()?.offsetWidth;
    if (w) save(w);
  };
  const reset = () => {
    const w = clamp(initial);
    apply(w);
    save(w);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = pane();
    if (!el) return;
    const grow = edge === "end" ? "ArrowRight" : "ArrowLeft";
    const shrink = edge === "end" ? "ArrowLeft" : "ArrowRight";
    let w: number | null = null;
    if (e.key === grow) w = el.offsetWidth + STEP;
    else if (e.key === shrink) w = el.offsetWidth - STEP;
    else if (e.key === "Home") w = min;
    else if (e.key === "End") w = max;
    else if (e.key === "Enter") w = initial;
    if (w === null) return;
    e.preventDefault();
    w = clamp(w);
    apply(w);
    save(w);
  };

  return (
    <div
      ref={ref}
      className={`resize-handle resize-handle--${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Arraste para ajustar a largura · duplo clique restaura"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  );
}
