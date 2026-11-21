import { Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";

const MAX_ZOOM = 8;
const CLICK_ZOOM = 2.5;
const PAN_STEP = 60;

type View = { zoom: number; x: number; y: number; animate: boolean };
const FIT: View = { zoom: 1, x: 0, y: 0, animate: true };

export interface ZoomableImageHandle {
  /** Teclas do visualizador: + − 0 e setas (só com zoom). Devolve true se tratou; senão a galeria usa a seta para trocar de foto. */
  key: (e: KeyboardEvent) => boolean;
}

/**
 * Imagem ajustada ao espaço disponível, sem rolagem. Zoom por clique (alterna), roda, pinça ou teclado,
 * sempre no ponto do cursor; com zoom, arrastar move. `x`/`y` deslocam o centro da imagem em relação ao centro da área.
 */
export function ZoomableImage({ src, alt = "", onError, ref }: { src: string; alt?: string; onError?: () => void; ref?: Ref<ZoomableImageHandle> }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(FIT);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; vx: number; vy: number; dist: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fit = natural.w && stage.w ? Math.min(1, stage.w / natural.w, stage.h / natural.h) : 0;
  const baseW = natural.w * fit;
  const baseH = natural.h * fit;
  const clamp = (v: View): View => {
    const ox = Math.max(0, (baseW * v.zoom - stage.w) / 2);
    const oy = Math.max(0, (baseH * v.zoom - stage.h) / 2);
    return { ...v, x: Math.min(ox, Math.max(-ox, v.x)), y: Math.min(oy, Math.max(-oy, v.y)) };
  };
  const shown = clamp(view);

  /** Zoom mantendo parado o ponto (relativo ao centro da área) que está sob o cursor. */
  const zoomAt = (v: View, next: number, px = 0, py = 0, animate = false): View => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, next));
    const c = clamp(v);
    return clamp({ zoom, x: px - ((px - c.x) / c.zoom) * zoom, y: py - ((py - c.y) / c.zoom) * zoom, animate });
  };
  const fromCenter = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { px: clientX - r.left - r.width / 2, py: clientY - r.top - r.height / 2 };
  };

  // Funções atuais para os ouvintes nativos registrados uma vez.
  const live = useRef({ zoomAt, fromCenter, clamp });
  live.current = { zoomAt, fromCenter, clamp };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    // Roda e pinça (chega como roda com Ctrl) precisam de preventDefault: o onWheel do React é passivo.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const { px, py } = live.current.fromCenter(e.clientX, e.clientY);
      setView((v) => live.current.zoomAt(v, v.zoom * Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0025)), px, py));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      key(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === "+" || e.key === "=") setView((v) => zoomAt(v, v.zoom * 1.5, 0, 0, true));
        else if (e.key === "-") setView((v) => zoomAt(v, v.zoom / 1.5, 0, 0, true));
        else if (e.key === "0") setView(FIT);
        else if (e.key === "Enter" && !(e.target instanceof HTMLElement && e.target.closest("a, button"))) setView((v) => (v.zoom > 1 ? FIT : zoomAt(v, CLICK_ZOOM, 0, 0, true)));
        else if (view.zoom > 1 && e.key.startsWith("Arrow")) {
          const dx = e.key === "ArrowLeft" ? PAN_STEP : e.key === "ArrowRight" ? -PAN_STEP : 0;
          const dy = e.key === "ArrowUp" ? PAN_STEP : e.key === "ArrowDown" ? -PAN_STEP : 0;
          const next = clamp({ ...shown, x: shown.x + dx, y: shown.y + dy, animate: true });
          // Já na borda: a seta lateral volta para a galeria trocar de foto.
          if (next.x === shown.x && next.y === shown.y) return false;
          setView(next);
        } else return false;
        return true;
      },
    }),
  );

  const release = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) setDragging(false);
  };

  const percent = Math.round(view.zoom * fit * 100);
  return (
    <div
      ref={stageRef}
      className={`zoomable${view.zoom > 1 ? " zoomable--zoomed" : ""}${dragging ? " zoomable--dragging" : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest(".zoomable__controls")) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        const pts = [...pointers.current.values()];
        const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
        const moved = pts.length === 1 ? false : (gesture.current?.moved ?? false);
        gesture.current = { x: mid.x, y: mid.y, vx: shown.x, vy: shown.y, dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, moved };
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || !pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...pointers.current.values()];
        if (pts.length >= 2) {
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          const { px, py } = fromCenter((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
          const ratio = dist / (g.dist || dist);
          g.moved = true;
          g.dist = dist;
          setView((v) => zoomAt(v, v.zoom * ratio, px, py));
          return;
        }
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.moved = true;
        if (view.zoom <= 1 || !g.moved) return;
        setDragging(true);
        setView((v) => clamp({ ...v, x: g.vx + e.clientX - g.x, y: g.vy + e.clientY - g.y, animate: false }));
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".zoomable__controls")) return;
        // Clique que terminou um arrasto ou uma pinça não muda o zoom.
        if (gesture.current?.moved) {
          e.stopPropagation();
          return;
        }
        // Com a captura do ponteiro o clique chega no palco, não na imagem: confere pela posição.
        const r = e.currentTarget.querySelector("img")!.getBoundingClientRect();
        const onImage = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!onImage && view.zoom === 1) return; // fundo sem zoom: o visualizador fecha
        e.stopPropagation();
        const { px, py } = fromCenter(e.clientX, e.clientY);
        setView((v) => (v.zoom > 1 ? FIT : zoomAt(v, CLICK_ZOOM, px, py, true)));
      }}
    >
      <img
        className={`zoomable__img${view.animate ? " zoomable__img--animate" : ""}`}
        src={src}
        alt={alt}
        draggable={false}
        style={{ width: baseW || undefined, height: baseH || undefined, visibility: fit ? undefined : "hidden", transform: `translate(calc(-50% + ${shown.x}px), calc(-50% + ${shown.y}px)) scale(${view.zoom})` }}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onError={onError}
      />
      {fit > 0 && (
        <div className="zoomable__controls" role="group" aria-label="Zoom">
          <button type="button" aria-label="Diminuir zoom (−)" title="Diminuir (−)" disabled={view.zoom <= 1} onClick={() => setView((v) => zoomAt(v, v.zoom / 1.5, 0, 0, true))}>
            <Minus size={16} aria-hidden />
          </button>
          <output aria-live="polite" aria-label="Zoom atual">{percent}%</output>
          <button type="button" aria-label="Aumentar zoom (+)" title="Aumentar (+)" disabled={view.zoom >= MAX_ZOOM} onClick={() => setView((v) => zoomAt(v, v.zoom * 1.5, 0, 0, true))}>
            <Plus size={16} aria-hidden />
          </button>
          <button type="button" aria-label="Ajustar à tela (0)" title="Ajustar à tela (0)" disabled={view.zoom === 1} onClick={() => setView(FIT)}>
            <Maximize size={15} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
