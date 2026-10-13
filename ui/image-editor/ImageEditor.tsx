import { Check, Crop, EyeOff, FlipHorizontal2, LoaderCircle, Pencil, Redo2, RotateCw, TriangleAlert, Type, Undo2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Dialog, SegmentedControl } from "../ds/index.ts";
import {
  addLayer, aspectCrop, clampRect, commit, cropHandleAt, dragCrop, isDirty, outputSize, outToSrc, rectFrom, rectOutToSrc, rectSrcToOut,
  redo, removeLayer, replaceLayer, resetGeometry, rotate, setCrop, srcToOut, startHistory, textAt, toggleFlip, uncropped, undo,
  initialState, type EditState, type Handle, type History, type Layer, type Point, type Rect, type TextLayer,
} from "./model.ts";
import { exportEdited, loadBitmap, measureText, paint, textFont, tokenColor } from "./render.ts";
import "./image-editor.css";

type Tool = "crop" | "draw" | "text" | "blur";
type Size = "s" | "m" | "l";
type AspectKey = "free" | "1:1" | "4:3" | "16:9";
const ASPECTS: Record<AspectKey, number | null> = { free: null, "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9 };
const INKS = ["red-700", "amber-700", "green-600", "blue-600", "navy-900", "ink-950", "white"] as const;
type Ink = (typeof INKS)[number];
const INK_LABEL: Record<Ink, string> = {
  "red-700": "Vermelho", "amber-700": "Amarelo", "green-600": "Verde", "blue-600": "Azul", "navy-900": "Azul-marinho", "ink-950": "Preto", white: "Branco",
};
/** Em px de tela; viram px da imagem dividindo pela escala da vista. */
const STROKE: Record<Size, number> = { s: 3, m: 6, l: 12 };
const TEXT: Record<Size, number> = { s: 20, m: 30, l: 44 };

type Typing = { id: number | null; at: Point; value: string; color: string; size: number };
type Gesture =
  | { kind: "draw"; draft: Layer }
  | { kind: "blur"; from: Point; draft: Layer | null }
  | { kind: "crop"; handle: Handle; from: Point; start: Rect; rect: Rect | null }
  | { kind: "text"; layer: TextLayer; from: Point; draft: Layer | null };

let lastLayerId = 0;
const nextLayerId = () => ++lastLayerId;

/** Editor de imagem em tela cheia: cortar/girar, desenhar, texto e borrar. Devolve um File novo em `onDone`. */
export function ImageEditor({ file, onDone, onClose }: { file: File; onDone: (file: File) => void; onClose: () => void }) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [tool, setTool] = useState<Tool>("draw");
  const [ink, setInk] = useState<Ink>("red-700");
  const [size, setSize] = useState<Size>("m");
  const [aspect, setAspect] = useState<AspectKey>("free");
  const [draft, setDraft] = useState<Layer | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const typingRef = useRef(typing);
  typingRef.current = typing;

  useEffect(() => {
    let alive = true;
    let opened: ImageBitmap | null = null;
    loadBitmap(file).then(
      (b) => {
        if (!alive) return b.close();
        opened = b;
        setBitmap(b);
        setHist(startHistory(initialState(b.width, b.height)));
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
      opened?.close();
    };
  }, [file]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => opener?.focus();
  }, []);

  const s = hist?.present ?? null;
  const view = useMemo(() => (s && tool === "crop" ? uncropped(s) : s), [s, tool]);
  // O texto em edição sai do canvas enquanto o campo está aberto.
  const painted = useMemo(
    () => (view && typing?.id != null ? { ...view, layers: view.layers.filter((l) => l.id !== typing.id) } : view),
    [view, typing?.id],
  );
  const out = view ? outputSize(view) : { width: 1, height: 1 };
  const scale = box.width && box.height ? Math.min(box.width / out.width, box.height / out.height, 4) : 0;
  const handlePx = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 24 : 14;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap || !painted || !scale) return;
    paint(c.getContext("2d")!, bitmap, painted, scale * (window.devicePixelRatio || 1), draft ?? undefined);
  }, [bitmap, painted, scale, draft]);

  const dirty = hist ? isDirty(hist) : false;
  const change = (next: (st: EditState) => EditState) => setHist((h) => (h ? commit(h, next(h.present)) : h));
  const tryClose = () => {
    if (saving) return;
    if (dirty) setAsking(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (asking) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (typingRef.current) {
          typingRef.current = null;
          setTyping(null);
        } else tryClose();
        return;
      }
      if (typingRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        setHist((h) => h && (e.shiftKey ? redo(h) : undo(h)));
      } else if (mod && key === "y") {
        e.preventDefault();
        setHist((h) => h && redo(h));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const finishTyping = () => {
    const t = typingRef.current;
    if (!t) return;
    typingRef.current = null;
    setTyping(null);
    const text = t.value.trim();
    const id = t.id;
    if (id == null) {
      if (text) change((st) => addLayer(st, { kind: "text", id: nextLayerId(), color: t.color, size: t.size, text, at: t.at }));
      return;
    }
    if (!text) return change((st) => removeLayer(st, id));
    const old = s?.layers.find((l) => l.id === id);
    if (old?.kind === "text" && old.text === text && old.color === t.color) return;
    change((st) => replaceLayer(st, { kind: "text", id, color: t.color, size: t.size, text, at: t.at }));
  };

  const pointOut = (e: ReactPointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Com texto aberto, o clique só tira o foco do campo (o blur confirma o texto).
    if (!view || !s || saving || e.button !== 0 || typingRef.current) return;
    const p = pointOut(e);
    const src = outToSrc(view, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "draw") {
      const first: Layer = { kind: "stroke", id: nextLayerId(), color: tokenColor(ink), width: STROKE[size] / scale, points: [src] };
      gesture.current = { kind: "draw", draft: first };
      setDraft(first);
    } else if (tool === "blur") {
      gesture.current = { kind: "blur", from: src, draft: null };
    } else if (tool === "crop") {
      const rect = rectSrcToOut(view, s.crop);
      gesture.current = { kind: "crop", handle: cropHandleAt(rect, p, handlePx / scale), from: p, start: rect, rect: null };
    } else {
      const hit = textAt(view, p, measureText);
      if (hit) gesture.current = { kind: "text", layer: hit, from: src, draft: null };
      else setTyping({ id: null, at: src, value: "", color: tokenColor(ink), size: TEXT[size] / scale });
    }
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !view) return;
    const p = pointOut(e);
    const src = outToSrc(view, p);
    if (g.kind === "draw" && g.draft.kind === "stroke") {
      const last = g.draft.points.at(-1)!;
      if (Math.hypot(src.x - last.x, src.y - last.y) * scale < 1.5) return;
      g.draft = { ...g.draft, points: [...g.draft.points, src] };
      setDraft(g.draft);
    } else if (g.kind === "blur") {
      g.draft = { kind: "blur", id: 0, rect: rectFrom(g.from, src) };
      setDraft(g.draft);
    } else if (g.kind === "crop") {
      g.rect = dragCrop(g.start, g.handle, g.from, p, outputSize(view), ASPECTS[aspect]);
      setCropDraft(g.rect);
    } else if (g.kind === "text") {
      g.draft = { ...g.layer, at: { x: g.layer.at.x + src.x - g.from.x, y: g.layer.at.y + src.y - g.from.y } };
      setDraft(g.draft);
    }
  };

  const up = () => {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    setCropDraft(null);
    if (!g || !view || !s) return;
    if (g.kind === "draw") change((st) => addLayer(st, g.draft));
    else if (g.kind === "blur" && g.draft?.kind === "blur") {
      const rect = clampRect(s, g.draft.rect);
      if (rect.w * scale >= 6 && rect.h * scale >= 6) change((st) => addLayer(st, { kind: "blur", id: nextLayerId(), rect }));
    } else if (g.kind === "crop" && g.rect && g.rect.w * scale >= 12 && g.rect.h * scale >= 12) {
      const rect = g.rect;
      change((st) => setCrop(st, rectOutToSrc(view, rect)));
    } else if (g.kind === "text") {
      if (g.draft) {
        const moved = g.draft;
        change((st) => replaceLayer(st, moved));
      } else setTyping({ id: g.layer.id, at: g.layer.at, value: g.layer.text, color: g.layer.color, size: g.layer.size });
    }
  };

  const pickTool = (next: Tool) => {
    finishTyping();
    setTool(next);
  };
  const pickInk = (next: Ink) => {
    setInk(next);
    if (typingRef.current) setTyping({ ...typingRef.current, color: tokenColor(next) });
  };
  const pickAspect = (key: AspectKey) => {
    setAspect(key);
    const ratio = ASPECTS[key];
    if (ratio) change((st) => setCrop(st, rectOutToSrc(uncropped(st), aspectCrop(outputSize(uncropped(st)), ratio))));
  };

  const done = async () => {
    if (!bitmap || !hist || saving) return;
    if (!isDirty(hist)) return onClose();
    setSaving(true);
    setError(null);
    try {
      onDone(await exportEdited(bitmap, hist.present, file));
    } catch {
      setError("Não foi possível salvar a edição. Tente de novo.");
      setSaving(false);
    }
  };

  const cropRect = tool === "crop" && view && s ? cropDraft ?? rectSrcToOut(view, s.crop) : null;
  const typingAt = typing && view ? srcToOut(view, typing.at) : null;
  const sizeLabels = tool === "text" ? ["Pequeno", "Médio", "Grande"] : ["Fina", "Média", "Grossa"];

  return (
    <div ref={root} className="image-editor" role="dialog" aria-modal="true" aria-label="Editar imagem">
      <header className="image-editor__bar">
        <Button variant="ghost" icon={<X size={18} aria-hidden />} aria-label="Fechar editor" disabled={saving} onClick={tryClose} />
        <span className="image-editor__title">Editar imagem</span>
        <Button variant="ghost" icon={<Undo2 size={18} aria-hidden />} aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!hist?.past.length || saving} onClick={() => setHist((h) => h && undo(h))} />
        <Button variant="ghost" icon={<Redo2 size={18} aria-hidden />} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" disabled={!hist?.future.length || saving} onClick={() => setHist((h) => h && redo(h))} />
        <Button variant="primary" icon={<Check size={16} aria-hidden />} loading={saving} disabled={!bitmap} onClick={() => void done()}>
          Concluir
        </Button>
      </header>

      <div ref={stage} className="image-editor__stage" onClick={(e) => e.target === e.currentTarget && tryClose()}>
        {error && (
          <p className="viewer__error viewer__error--dark" role="alert">
            <TriangleAlert size={14} aria-hidden /> {error}
          </p>
        )}
        {!bitmap && !error && <LoaderCircle className="spin" size={28} aria-label="Abrindo imagem" />}
        {bitmap && view && scale > 0 && (
          <div
            className={`image-editor__canvas image-editor__canvas--${tool}`}
            style={{ width: out.width * scale, height: out.height * scale }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <canvas ref={canvas} />
            {cropRect && (
              <div className="image-editor__crop" style={{ left: cropRect.x * scale, top: cropRect.y * scale, width: cropRect.w * scale, height: cropRect.h * scale }} aria-hidden>
                {(["nw", "ne", "sw", "se"] as const).map((h) => <span key={h} className={`image-editor__handle image-editor__handle--${h}`} />)}
              </div>
            )}
            {typing && typingAt && (
              <textarea
                className="image-editor__text"
                autoFocus
                rows={1}
                aria-label="Texto sobre a imagem"
                value={typing.value}
                style={{ left: typingAt.x * scale, top: typingAt.y * scale, font: textFont(typing.size * scale), color: typing.color }}
                onChange={(e) => setTyping({ ...typing, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                onBlur={finishTyping}
                onPointerDown={(e) => e.stopPropagation()}
              />
            )}
          </div>
        )}
      </div>

      <footer className="image-editor__tools">
        <SegmentedControl<Tool>
          aria-label="Ferramenta"
          fullWidth
          value={tool}
          onChange={pickTool}
          options={[
            { value: "crop", label: <><Crop size={16} aria-hidden /> Cortar</> },
            { value: "draw", label: <><Pencil size={16} aria-hidden /> Desenhar</> },
            { value: "text", label: <><Type size={16} aria-hidden /> Texto</> },
            { value: "blur", label: <><EyeOff size={16} aria-hidden /> Borrar</> },
          ]}
        />
        <div className="image-editor__options">
          {tool === "crop" ? (
            <>
              <SegmentedControl<AspectKey>
                aria-label="Proporção"
                size="compact"
                value={aspect}
                onChange={pickAspect}
                options={[{ value: "free", label: "Livre" }, { value: "1:1", label: "1:1" }, { value: "4:3", label: "4:3" }, { value: "16:9", label: "16:9" }]}
              />
              <Button variant="secondary" size="compact" icon={<RotateCw size={16} aria-hidden />} disabled={!s} onClick={() => change(rotate)}>
                Girar
              </Button>
              <Button variant="secondary" size="compact" icon={<FlipHorizontal2 size={16} aria-hidden />} disabled={!s} onClick={() => change(toggleFlip)}>
                Espelhar
              </Button>
              <Button variant="ghost" size="compact" disabled={!s} onClick={() => { setAspect("free"); change(resetGeometry); }}>
                Restaurar
              </Button>
            </>
          ) : tool === "blur" ? (
            <p className="hint">Arraste sobre a área que deve ficar ilegível.</p>
          ) : (
            <>
              <div className="image-editor__inks" role="group" aria-label="Cor">
                {INKS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="image-editor__ink"
                    aria-label={INK_LABEL[name]}
                    aria-pressed={ink === name}
                    style={{ backgroundColor: `var(--bt-color-${name})` }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickInk(name)}
                  />
                ))}
              </div>
              <SegmentedControl<Size>
                aria-label={tool === "text" ? "Tamanho do texto" : "Espessura"}
                size="compact"
                value={size}
                onChange={setSize}
                options={[{ value: "s", label: sizeLabels[0] }, { value: "m", label: sizeLabels[1] }, { value: "l", label: sizeLabels[2] }]}
              />
            </>
          )}
        </div>
      </footer>

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Descartar alterações?"
        tone="danger"
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Continuar editando
            </Button>
            <Button variant="danger" onClick={onClose}>
              Descartar
            </Button>
          </>
        }
      >
        As edições desta imagem serão perdidas.
      </Dialog>
    </div>
  );
}
