import { Check, Copy, Download, ExternalLink, Eye, FileText, LoaderCircle, Mic, Pause, Play, RefreshCw, Reply, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, mediaUrl, type AudioSummary, type Message, type OutgoingMedia } from "./api.ts";
import { desktop } from "./desktop.ts";
import { webmToOgg } from "./ogg.ts";
import { Button, Select } from "./ds/index.ts";

/** "1:05" a partir de segundos. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const SPEEDS = [1, 1.5, 2];
/** Só um áudio toca por vez: o que começa pausa o anterior. */
let playing: HTMLAudioElement | null = null;

export function AudioPlayer({ src, seconds, voice, onError }: { src: string; seconds: number | null; voice: boolean; onError: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(seconds ?? 0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => () => {
    if (playing === audio.current) playing = null;
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) return el.pause();
    if (playing && playing !== el) playing.pause();
    playing = el;
    if (el.readyState < 2) setLoading(true);
    el.playbackRate = speed;
    void el.play().catch(() => setLoading(false));
  };
  /** Intenção de tocar: já pede o arquivo, para o clique não esperar o download. */
  const warm = () => {
    const el = audio.current;
    if (el && el.preload === "none") {
      el.preload = "auto";
      el.load();
    }
  };
  const cycle = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };
  const total = duration || seconds || 0;
  return (
    <div className={`audio${voice ? " audio--voice" : ""}`}>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPlaying={() => setLoading(false)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onError={onError}
      />
      <button
        type="button"
        className="audio__play"
        onPointerEnter={warm}
        onFocus={warm}
        onClick={toggle} aria-label={isPlaying ? "Pausar áudio" : "Tocar áudio"} aria-busy={loading || undefined}>
        {isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
      <div className="audio__track">
        <div className="audio__bar">
        <span className="audio__fill" style={{ width: `${total ? Math.min(100, (time / total) * 100) : 0}%` }} />
        <input
          type="range"
          className="audio__seek"
          min={0}
          max={total || 1}
          step={0.1}
          value={Math.min(time, total || 1)}
          aria-label="Posição do áudio"
          aria-valuetext={`${clock(time)} de ${clock(total)}`}
          onChange={(e) => {
            const t = Number(e.target.value);
            setTime(t);
            if (audio.current) audio.current.currentTime = t;
          }}
        />
        </div>
        <span className="audio__time">
          {voice && <Mic size={12} aria-hidden />}
          {isPlaying || time > 0 ? clock(time) : total ? clock(total) : "--:--"}
        </span>
      </div>
      <button type="button" className="audio__speed" onClick={cycle} aria-label={`Velocidade ${speed}x`}>
        {String(speed).replace(".", ",")}×
      </button>
    </div>
  );
}

// ---- Copiar e visualizar mídia

/** Erro do IPC chega como "Error invoking remote method 'x': Error: texto". */
const bridgeError = (e: unknown) => ((e as Error)?.message ?? "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "Não foi possível concluir.";

/** Imagem copiável como imagem; o resto só como arquivo, pelo app desktop. */
export const canCopyMedia = (m: Message) => !!m.media && (m.media.type === "image" || m.media.type === "sticker" || !!desktop()?.copyFile);

/** Copia a mídia e devolve a confirmação a mostrar. Imagem vira PNG (o único formato que a área de transferência aceita). */
export async function copyMedia(m: Message): Promise<string> {
  const media = m.media;
  if (!media) throw new Error("Esta mensagem não tem mídia.");
  if (media.type === "image" || media.type === "sticker") {
    const res = await fetch(mediaUrl(m));
    if (!res.ok) throw new Error("Não foi possível abrir a imagem. Ela pode ter expirado no WhatsApp.");
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await canvas.convertToBlob({ type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "Imagem copiada.";
  }
  const bridge = desktop();
  if (!bridge?.copyFile) throw new Error("Copiar arquivo só funciona no app desktop.");
  await bridge.copyFile(m.chatJid, m.id).catch((e: unknown) => {
    throw new Error(bridgeError(e));
  });
  return "Arquivo copiado. Cole com Ctrl+V onde quiser.";
}

/** Pede a uma bolha de mídia que abra a própria visualização (menu de contexto). */
export const viewMedia = (m: Message) => window.dispatchEvent(new CustomEvent("inbox:view-media", { detail: { chatJid: m.chatJid, id: m.id } }));

function useViewRequest(m: Message, open: () => void) {
  useEffect(() => {
    const onView = (e: Event) => {
      const d = (e as CustomEvent<{ chatJid: string; id: string }>).detail;
      if (d.chatJid === m.chatJid && d.id === m.id) open();
    };
    window.addEventListener("inbox:view-media", onView);
    return () => window.removeEventListener("inbox:view-media", onView);
  }, [m.chatJid, m.id, open]);
}

type PreviewKind = "pdf" | "image" | "video" | "audio" | "text";
const KIND_BY_EXT: Record<string, PreviewKind> = { pdf: "pdf", png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", txt: "text", csv: "text" };

/** O que abre dentro do app. SVG e HTML ficam de fora: rodariam script na origem do app. */
export function previewKind(media: NonNullable<Message["media"]>): PreviewKind | null {
  const mime = media.mimetype.toLowerCase().split(";")[0].trim();
  if (mime === "application/pdf") return "pdf";
  if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime)) return "image";
  if (/^video\/(mp4|webm)$/.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  if (/^text\/(plain|csv)$/.test(mime) || mime === "application/json") return "text";
  if (!mime || mime === "application/octet-stream") return KIND_BY_EXT[(media.fileName?.split(".").pop() ?? "").toLowerCase()] ?? null;
  return null;
}

/** Texto acima disso não abre na visualização (fica pesado); abre no app padrão. */
const TEXT_LIMIT = 1024 * 1024;

function TextPreview({ src }: { src: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [src]);
  if (error) return <p className="viewer__empty">Não foi possível abrir o texto.</p>;
  if (text === null)
    return (
      <p className="viewer__empty" role="status">
        <LoaderCircle size={16} className="spin" aria-hidden /> Abrindo…
      </p>
    );
  return <pre className="viewer__text">{text}</pre>;
}

/** Botão de copiar com confirmação no próprio botão (o modal cobre os toasts). */
function CopyMediaButton({ m, onError }: { m: Message; onError: (text: string | null) => void }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const image = m.media?.type === "image" || m.media?.type === "sticker";
  const run = async () => {
    setState("busy");
    onError(null);
    try {
      await copyMedia(m);
      setState("done");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 1600);
    } catch (e) {
      setState("idle");
      onError((e as Error).message);
    }
  };
  return (
    <button type="button" className="button button--secondary" onClick={() => void run()} disabled={state === "busy"} aria-busy={state === "busy" || undefined}>
      {state === "busy" ? <LoaderCircle size={16} className="spin" aria-hidden /> : state === "done" ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      {state === "done" ? "Copiado" : image ? "Copiar imagem" : "Copiar arquivo"}
    </button>
  );
}

/** Foco preso no diálogo e devolvido a quem abriu; Esc fecha. */
function useDialog(panel: React.RefObject<HTMLElement | null>, first: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && panel.current) {
        const list = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), video, audio, iframe")];
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          list[list.length - 1]?.focus();
        } else if (!e.shiftKey && i === list.length - 1) {
          e.preventDefault();
          list[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [panel, first, onClose]);
}

/** Abre o arquivo dentro do app, sem baixar. Formatos que o app não mostra vão para o app padrão do Windows. */
function FileViewer({ m, onClose }: { m: Message; onClose: () => void }) {
  const media = m.media!;
  const src = mediaUrl(m);
  const name = media.fileName ?? "Documento";
  const kind = previewKind(media);
  const tooBig = kind === "text" && (media.size ?? 0) > TEXT_LIMIT;
  const bridge = desktop();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  useDialog(panel, close, onClose);
  const openExternal = async () => {
    if (!bridge?.openFile) return;
    setOpening(true);
    setError(null);
    try {
      await bridge.openFile(m.chatJid, m.id);
    } catch (e) {
      setError(bridgeError(e));
    } finally {
      setOpening(false);
    }
  };
  const ext = (media.fileName?.split(".").pop() ?? media.mimetype.split("/").pop() ?? "").slice(0, 4).toUpperCase();
  return (
    <div className="modal viewer" role="dialog" aria-modal="true" aria-label={`Visualizar ${name}`}>
      <div className="modal__overlay" onClick={onClose} />
      <div ref={panel} className="modal__panel surface viewer__panel">
        <header className="viewer__header">
          <span className="media-doc__icon" aria-hidden>
            <FileText size={20} />
          </span>
          <span className="viewer__title">
            <strong title={name}>{name}</strong>
            <span className="hint">{[ext, media.size ? fileSize(media.size) : null].filter(Boolean).join(" · ")}</span>
          </span>
          <div className="viewer__actions">
            {canCopyMedia(m) && <CopyMediaButton m={m} onError={setError} />}
            {bridge?.openFile && (
              <button type="button" className="button button--secondary" onClick={() => void openExternal()} disabled={opening} aria-busy={opening || undefined}>
                {opening ? <LoaderCircle size={16} className="spin" aria-hidden /> : <ExternalLink size={16} aria-hidden />} Abrir no app
              </button>
            )}
            <a className="button button--secondary" href={mediaUrl(m, true)} download>
              <Download size={16} aria-hidden /> Baixar
            </a>
            <button ref={close} type="button" className="icon-button" aria-label="Fechar visualização (Esc)" title="Fechar (Esc)" onClick={onClose}>
              <X size={18} aria-hidden />
            </button>
          </div>
        </header>
        {error && (
          <p className="viewer__error" role="alert">
            <TriangleAlert size={14} aria-hidden /> {error}
          </p>
        )}
        <div className="viewer__body">
          {kind === "pdf" ? (
            // O nome no fim do endereço vira o título na barra do visualizador de PDF.
            <iframe className="viewer__frame" src={`${src}/${encodeURIComponent(name)}`} title={name} />
          ) : kind === "image" ? (
            <img className="viewer__image" src={src} alt={name} />
          ) : kind === "video" ? (
            <video className="viewer__image" src={src} controls autoPlay />
          ) : kind === "audio" ? (
            <audio src={src} controls autoPlay />
          ) : kind === "text" && !tooBig ? (
            <TextPreview src={src} />
          ) : (
            <div className="viewer__empty">
              <FileText size={32} aria-hidden />
              <p>
                <strong>{tooBig ? "Arquivo grande demais para mostrar aqui." : "Este tipo de arquivo não abre dentro do app."}</strong>
              </p>
              <p className="hint">{bridge?.openFile ? "Abra no app padrão do Windows: o arquivo não vai para Downloads." : "Baixe o arquivo para abrir no computador."}</p>
              {bridge?.openFile ? (
                <button type="button" className="button button--primary" onClick={() => void openExternal()} disabled={opening} aria-busy={opening || undefined}>
                  {opening ? <LoaderCircle size={16} className="spin" aria-hidden /> : <ExternalLink size={16} aria-hidden />} Abrir no app padrão
                </button>
              ) : (
                <a className="button button--primary" href={mediaUrl(m, true)} download>
                  <Download size={16} aria-hidden /> Baixar
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Miniatura no balão: primeira página do PDF (visualizador do Chromium, sem interação) ou a imagem. */
function DocThumb({ m, kind }: { m: Message; kind: PreviewKind }) {
  const src = mediaUrl(m);
  const [loaded, setLoaded] = useState(false);
  // Esconde até carregar: o visualizador do PDF começa como um quadro escuro.
  return (
    <div className={`media-doc__thumb${loaded ? "" : " media-doc__thumb--loading"}`}>
      {kind === "image" ? (
        <img className="media-doc__thumb-image" src={src} alt="" loading="lazy" onLoad={() => setLoaded(true)} />
      ) : (
        <iframe className="media-doc__thumb-pdf" src={`${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title="" tabIndex={-1} aria-hidden loading="lazy" onLoad={() => setLoaded(true)} />
      )}
    </div>
  );
}

function DocCard({ m }: { m: Message }) {
  const media = m.media!;
  const [viewing, setViewing] = useState(false);
  const open = useCallback(() => setViewing(true), []);
  const closeViewer = useCallback(() => setViewing(false), []);
  useViewRequest(m, open);
  const kind = previewKind(media);
  const name = media.fileName ?? "Documento";
  const ext = (media.fileName?.split(".").pop() ?? media.mimetype.split("/").pop() ?? "").slice(0, 4).toUpperCase();
  return (
    <div className="media-doc">
      {/* O cartão inteiro abre a visualização com o mouse; no teclado, o botão "Ver" faz o mesmo. */}
      <div className="media-doc__card" onClick={open}>
        {(kind === "pdf" || kind === "image") && <DocThumb m={m} kind={kind} />}
        <div className="media-doc__row">
          <span className="media-doc__icon" aria-hidden>
            <FileText size={20} />
          </span>
          <span className="media-doc__info">
            <span className="media-doc__name" title={name}>{name}</span>
            <span className="hint">{[ext, media.size ? fileSize(media.size) : null].filter(Boolean).join(" · ")}</span>
          </span>
        </div>
      </div>
      <div className="media-doc__actions">
        <button type="button" className="media-doc__action" onClick={open} aria-label={`Ver ${name}`}>
          <Eye size={16} aria-hidden /> Ver
        </button>
        <a className="media-doc__action" href={mediaUrl(m, true)} download aria-label={`Baixar ${name}`}>
          <Download size={16} aria-hidden /> Baixar
        </a>
      </div>
      {viewing && <FileViewer m={m} onClose={closeViewer} />}
    </div>
  );
}

function Lightbox({ m, src, download, onClose }: { m: Message; src: string; download: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  useDialog(panel, close, onClose);
  return (
    <div ref={panel} className="lightbox" role="dialog" aria-modal="true" aria-label="Imagem ampliada" onClick={onClose}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      {error && (
        <p className="viewer__error viewer__error--dark" role="alert" onClick={(e) => e.stopPropagation()}>
          <TriangleAlert size={14} aria-hidden /> {error}
        </p>
      )}
      <div className="lightbox__actions" onClick={(e) => e.stopPropagation()}>
        <CopyMediaButton m={m} onError={setError} />
        <a className="button button--secondary" href={download} download>
          <Download size={16} aria-hidden /> Baixar
        </a>
        <Button ref={close} variant="primary" icon={<X size={16} aria-hidden />} onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

/** Transcrição sob demanda (Groq) e resumo pela IA. Ficam em cache no app; aqui só na sessão. */
const transcripts = new Map<string, string>();
const summaries = new Map<string, AudioSummary>();
const PRIORITY_LABEL = { alta: "Prioridade alta", media: "Prioridade média", baixa: "Prioridade baixa" } as const;
const PRIORITY_BADGE = { alta: "badge--danger", media: "badge--warning", baixa: "badge--neutral" } as const;

function AudioSummaryView({ s }: { s: AudioSummary }) {
  return (
    <div className="audio-summary">
      <p className="audio-summary__head">
        <span className={`badge ${PRIORITY_BADGE[s.prioridade]}`} title={s.motivo || undefined}>
          {PRIORITY_LABEL[s.prioridade]}
        </span>
        <strong>{s.assunto}</strong>
      </p>
      {s.pontos.length > 0 && (
        <ul className="audio-summary__points">
          {s.pontos.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {s.tratativa && (
        <p className="audio-summary__action">
          <span>Tratativa:</span> {s.tratativa}
        </p>
      )}
    </div>
  );
}

function Transcript({ m }: { m: Message }) {
  const cacheKey = `${m.chatJid}|${m.id}`;
  const [text, setText] = useState<string | null>(() => transcripts.get(cacheKey) ?? null);
  const [summary, setSummary] = useState<AudioSummary | null>(() => summaries.get(cacheKey) ?? null);
  /** Com resumo, ele aparece primeiro; o botão alterna para a transcrição original. */
  const [view, setView] = useState<"resumo" | "texto">("resumo");
  const [busy, setBusy] = useState<"transcrever" | "resumir" | null>(null);
  /** Resumo automático em andamento no servidor. */
  const [remote, setRemote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = useCallback(
    (value: string) => {
      const shown = value || "(sem fala reconhecida)";
      transcripts.set(cacheKey, shown);
      setText(shown);
    },
    [cacheKey],
  );
  const showSummary = useCallback(
    (value: AudioSummary) => {
      summaries.set(cacheKey, value);
      setSummary(value);
      setView("resumo");
    },
    [cacheKey],
  );
  // Já transcrito/resumido (manual ou automático): vem do cache do app, sem chamar a IA.
  useEffect(() => {
    if (transcripts.has(cacheKey)) return;
    let alive = true;
    api
      .cachedTranscript(m.chatJid, m.id)
      .then(({ text, summary }) => {
        if (!alive) return;
        if (text !== null) show(text);
        if (summary) showSummary(summary);
      })
      .catch(() => undefined);
    const mine = (d: { chatJid: string; id: string }) => d.chatJid === m.chatJid && d.id === m.id;
    const onTranscript = (e: Event) => {
      const d = (e as CustomEvent<{ chatJid: string; id: string; text: string }>).detail;
      if (mine(d)) show(d.text);
    };
    const onSummary = (e: Event) => {
      const d = (e as CustomEvent<{ chatJid: string; id: string; summary: AudioSummary }>).detail;
      if (mine(d)) {
        setRemote(false);
        showSummary(d.summary);
      }
    };
    const onStatus = (e: Event) => {
      const d = (e as CustomEvent<{ chatJid: string; id: string; state: string }>).detail;
      if (mine(d)) setRemote(d.state === "summarizing");
    };
    window.addEventListener("inbox:transcript", onTranscript);
    window.addEventListener("inbox:audio-summary", onSummary);
    window.addEventListener("inbox:audio-status", onStatus);
    return () => {
      alive = false;
      window.removeEventListener("inbox:transcript", onTranscript);
      window.removeEventListener("inbox:audio-summary", onSummary);
      window.removeEventListener("inbox:audio-status", onStatus);
    };
  }, [cacheKey, m.chatJid, m.id, show, showSummary]);
  const run = async (what: "transcrever" | "resumir", force = false) => {
    setBusy(what);
    setError(null);
    try {
      if (what === "transcrever") show((await api.transcribe(m.chatJid, m.id)).text);
      else showSummary((await api.summarizeAudio(m.chatJid, m.id, force)).summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const errorLine = error && (
    <span className="transcript__error" role="alert">
      {error}
    </span>
  );
  if (text === null) {
    return (
      <div className="transcript-bar">
        <Button variant="ghost" size="compact" onClick={() => void run("transcrever")} loading={busy !== null}>
          {busy ? "Transcrevendo…" : "Transcrever"}
        </Button>
        {errorLine}
      </div>
    );
  }
  const hasSpeech = text !== "(sem fala reconhecida)";
  const summarizing = busy === "resumir" || remote;
  const showingSummary = !!summary && view === "resumo";
  return (
    <div className="transcript-box">
      {summarizing ? (
        <p className="audio-summary audio-summary--loading" role="status">
          <LoaderCircle size={12} className="spin" aria-hidden /> Resumindo o áudio…
        </p>
      ) : showingSummary ? (
        <AudioSummaryView s={summary} />
      ) : (
        <p className="transcript">{text}</p>
      )}
      {hasSpeech && !summarizing && (
        <div className="transcript-bar">
          {summary ? (
            <>
              <Button variant="ghost" size="compact" onClick={() => setView((v) => (v === "resumo" ? "texto" : "resumo"))}>
                {view === "resumo" ? "Ver transcrição" : "Ver resumo"}
              </Button>
              {!m.fromMe && (
                <Button variant="ghost" size="compact" icon={<Reply size={14} aria-hidden />} onClick={() => window.dispatchEvent(new CustomEvent("inbox:suggest", { detail: { chatJid: m.chatJid } }))} title="Gerar um rascunho de resposta com base no áudio">
                  Responder
                </Button>
              )}
              <Button variant="ghost" size="compact" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void run("resumir", true)} disabled={busy !== null} aria-label="Gerar o resumo de novo" title="Gerar o resumo de novo" />
            </>
          ) : (
            <Button
              variant="ghost"
              size="compact"
              icon={<Sparkles size={14} aria-hidden />}
              onClick={() => void run("resumir")}
              disabled={busy !== null}
              title="Resumo com os pontos principais, a tratativa e a prioridade"
            >
              Resumir
            </Button>
          )}
          {errorLine}
        </div>
      )}
    </div>
  );
}

export function MediaView({ m, caption }: { m: Message; caption: string }) {
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const closeZoom = useCallback(() => setZoom(false), []);
  const openZoom = useCallback(() => setZoom(true), []);
  const media = m.media!;
  const image = media.type === "image" || media.type === "sticker";
  useViewRequest(m, image && !failed ? openZoom : noop);
  const src = mediaUrl(m);
  if (failed) {
    return (
      <p className="media-error">
        <TriangleAlert size={14} aria-hidden /> Não foi possível abrir. A mídia pode ter expirado no WhatsApp.
      </p>
    );
  }
  if (media.type === "image" || media.type === "sticker") {
    const sticker = media.type === "sticker";
    return (
      <>
        <button className={`media-thumb${loaded ? "" : " media-thumb--loading"}${sticker ? " media-thumb--sticker" : ""}`} onClick={() => setZoom(true)} aria-label="Ampliar imagem">
          <img
            src={src}
            alt={caption || (sticker ? "Figurinha" : "Imagem")}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={sticker ? "media-sticker" : undefined}
          />
        </button>
        {zoom && <Lightbox m={m} src={src} download={mediaUrl(m, true)} onClose={closeZoom} />}
      </>
    );
  }
  if (media.type === "video") return <video className="media-video" src={src} controls preload="metadata" onError={() => setFailed(true)} />;
  if (media.type === "audio")
    return (
      <>
        <AudioPlayer src={src} seconds={media.seconds} voice={media.ptt} onError={() => setFailed(true)} />
        <Transcript m={m} />
      </>
    );
  return <DocCard m={m} />;
}

const noop = () => undefined;

// ---- Envio

/** voice: mensagem de voz já pronta (envio que falhou volta para a bandeja e sai de novo como voz). */
export type Attachment = { id: number; file: File; preview: string | null; voice?: OutgoingMedia };

let nextId = 1;
export function toAttachment(file: File): Attachment {
  return { id: nextId++, file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null };
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function fileToOutgoing(file: File, caption?: string): Promise<OutgoingMedia> {
  return { fileName: file.name || "arquivo", mimetype: file.type || "application/octet-stream", data: base64(new Uint8Array(await file.arrayBuffer())), caption };
}

export const MAX_ATTACHMENT = 32 * 1024 * 1024;

export function AttachmentTray({ items, onRemove, disabled }: { items: Attachment[]; onRemove: (id: number) => void; disabled: boolean }) {
  return (
    <ul className="attachments" aria-label="Anexos a enviar">
      {items.map((a) => (
        <li key={a.id} className="attachment">
          {a.preview ? (
            <img className="attachment__thumb" src={a.preview} alt="" />
          ) : (
            <span className="attachment__thumb attachment__thumb--file" aria-hidden>
              <FileText size={18} />
            </span>
          )}
          <span className="attachment__info">
            <span className="attachment__name">{a.file.name}</span>
            <span className="hint">{fileSize(a.file.size)}</span>
          </span>
          <Button variant="ghost" size="compact" icon={<X size={14} aria-hidden />} aria-label={`Remover ${a.file.name}`} disabled={disabled} onClick={() => onRemove(a.id)} />
        </li>
      ))}
    </ul>
  );
}

/** Barras do medidor de nível (as mais novas à direita). */
const LEVEL_BARS = 40;
const MIC_KEY = "inbox.mic";
/** Abaixo disso por SILENCE_MS seguidos, avisa que o microfone não está captando. */
const SILENCE_LEVEL = 0.015;
const SILENCE_MS = 2500;

const savedMic = (): string => {
  try {
    return localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveMic = (id: string) => {
  try {
    localStorage.setItem(MIC_KEY, id);
  } catch {
    // preferência de conveniência; sem armazenamento, segue o padrão do sistema
  }
};

type Rec = {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  /** Tempo gravado antes do último "continuar" (ms) e quando o trecho atual começou. */
  base: number;
  since: number | null;
  quietSince: number | null;
  buffer: Float32Array<ArrayBuffer>;
};

function micError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "O acesso ao microfone foi negado. Libere o microfone para o app nas configurações do Windows.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Nenhum microfone encontrado. Conecte um microfone e tente de novo.";
  if (name === "NotReadableError") return "O microfone está em uso por outro programa ou falhou ao abrir.";
  return "Microfone indisponível. Confira se ele está conectado e liberado para o app.";
}

async function openMic(deviceId: string): Promise<MediaStream> {
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio });
  } catch (error) {
    // Microfone salvo sumiu (desconectado): cai no padrão do sistema.
    if (deviceId && error instanceof DOMException && (error.name === "OverconstrainedError" || error.name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia({ audio });
    }
    throw error;
  }
}

/**
 * Grava mensagem de voz pelo microfone e entrega Ogg/Opus pronto para o WhatsApp.
 * O áudio passa por um grafo Web Audio: dá o nível ao vivo e permite trocar de microfone
 * sem parar a gravação (o MediaRecorder grava a saída do grafo, não o microfone).
 */
export function useRecorder(onError: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(savedMic);
  const [preview, setPreview] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refreshDevices = useCallback(async () => {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId !== "communications");
      setDevices(list);
    } catch {
      setDevices([]);
    }
  }, []);
  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);

  const clearPreview = () =>
    setPreview((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });

  const teardown = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => undefined);
    clearPreview();
    setRecording(false);
    setPaused(false);
  };
  useEffect(
    () => () => {
      if (rec.current?.recorder.state !== "inactive") rec.current?.recorder.stop();
      teardown();
    },
    [],
  );

  const total = (r: Rec) => r.base + (r.since === null ? 0 : performance.now() - r.since);

  /**
   * Nível do microfone, tempo e aviso de silêncio, lidos pela barra de gravação.
   * Fica fora do estado do React: medir 15x/s não re-renderiza a conversa inteira.
   */
  const sample = useCallback((): { level: number | null; elapsed: number; silent: boolean } => {
    const r = rec.current;
    if (!r) return { level: null, elapsed: 0, silent: false };
    const now = performance.now();
    // Sem áudio do sistema (gravação direta) não há nível para medir.
    if (r.since === null || r.ctx.state !== "running") return { level: null, elapsed: total(r) / 1000, silent: false };
    r.analyser.getFloatTimeDomainData(r.buffer);
    let sum = 0;
    for (const v of r.buffer) sum += v * v;
    const rms = Math.sqrt(sum / r.buffer.length);
    if (rms < SILENCE_LEVEL) r.quietSince ??= now;
    else r.quietSince = null;
    // Escala perceptiva: fala normal fica no meio da barra.
    return { level: Math.min(1, Math.sqrt(rms) * 2.2), elapsed: total(r) / 1000, silent: r.quietSince !== null && now - r.quietSince > SILENCE_MS };
  }, []);

  const start = async () => {
    if (rec.current) return;
    const mime = "audio/webm;codecs=opus";
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported(mime)) return onErrorRef.current("Este computador não grava áudio em Opus.");
    let stream: MediaStream;
    try {
      stream = await openMic(deviceId);
    } catch (error) {
      return onErrorRef.current(micError(error));
    }
    const ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(dest);
    // Se o áudio do sistema não iniciar, grava direto do microfone (sem medidor e sem troca ao vivo)
    // para nunca entregar uma gravação vazia.
    const live = ctx.state === "running";
    const recorder = new MediaRecorder(live ? dest.stream : stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    const r: Rec = { ctx, dest, analyser, source, stream, recorder, chunks: [], base: 0, since: performance.now(), quietSince: null, buffer: new Float32Array(analyser.fftSize) };
    recorder.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    rec.current = r;
    recorder.start(250);
    setRecording(true);
    setPaused(false);
    // Com a permissão dada, os nomes dos microfones aparecem.
    void refreshDevices();
    const used = stream.getAudioTracks()[0]?.getSettings().deviceId;
    if (used && !deviceId) setDeviceId(used);
  };

  const pause = () => {
    const r = rec.current;
    if (!r || r.recorder.state !== "recording") return;
    r.recorder.pause();
    r.base = total(r);
    r.since = null;
    r.quietSince = null;
    setPaused(true);
    // Prévia do que já foi gravado: pede os dados pendentes e monta o arquivo.
    r.recorder.addEventListener(
      "dataavailable",
      () => {
        if (rec.current !== r || r.recorder.state !== "paused") return;
        clearPreview();
        setPreview(URL.createObjectURL(new Blob(r.chunks, { type: "audio/webm" })));
      },
      { once: true },
    );
    r.recorder.requestData();
  };

  const resume = () => {
    const r = rec.current;
    if (!r || r.recorder.state !== "paused") return;
    clearPreview();
    r.recorder.resume();
    r.since = performance.now();
    setPaused(false);
  };

  /** Troca o microfone; se estiver gravando, continua no mesmo arquivo. */
  const chooseDevice = async (id: string) => {
    setDeviceId(id);
    saveMic(id);
    const r = rec.current;
    if (!r) return;
    try {
      const stream = await openMic(id);
      if (rec.current !== r) return stream.getTracks().forEach((t) => t.stop());
      const source = r.ctx.createMediaStreamSource(stream);
      source.connect(r.analyser);
      source.connect(r.dest);
      r.source.disconnect();
      r.stream.getTracks().forEach((t) => t.stop());
      r.source = source;
      r.stream = stream;
      r.quietSince = null;
    } catch (error) {
      onErrorRef.current(micError(error));
    }
  };

  const cancel = () => {
    if (rec.current && rec.current.recorder.state !== "inactive") rec.current.recorder.stop();
    teardown();
  };

  /** Para e devolve o anexo de voz, ou null se curto demais. */
  const finish = async (): Promise<OutgoingMedia | null> => {
    const r = rec.current;
    if (!r) return null;
    const stopped = new Promise<void>((resolve) => (r.recorder.onstop = () => resolve()));
    r.recorder.stop();
    await stopped;
    const chunks = r.chunks;
    teardown();
    const webm = new Uint8Array(await new Blob(chunks).arrayBuffer());
    const { ogg, seconds } = webmToOgg(webm);
    if (seconds < 0.5) return null;
    return { fileName: "voz.ogg", mimetype: "audio/ogg", data: base64(ogg), ptt: true, seconds };
  };

  /** O que já foi gravado (pausado), para transcrever sem parar a gravação. */
  const snapshot = async (): Promise<{ data: string; mimetype: string } | null> => {
    const r = rec.current;
    if (!r || !r.chunks.length) return null;
    return { data: base64(new Uint8Array(await new Blob(r.chunks).arrayBuffer())), mimetype: "audio/webm" };
  };

  return { recording, paused, devices, deviceId, preview, start, pause, resume, cancel, finish, chooseDevice, sample, snapshot };
}

export type Recorder = ReturnType<typeof useRecorder>;

export function RecordingBar({ recorder, onTranscript, onError }: { recorder: Recorder; onTranscript: (text: string) => void; onError: (text: string) => void }) {
  const { paused, devices, deviceId, preview, sample } = recorder;
  const toggle = useRef<HTMLButtonElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [silent, setSilent] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  useEffect(() => toggle.current?.focus(), [paused]);
  // Medidor desenhado direto no DOM (~15x/s); o React só re-renderiza quando muda o segundo ou o aviso.
  useEffect(() => {
    const levels: number[] = Array(LEVEL_BARS).fill(0);
    const tick = () => {
      const s = sample();
      if (s.level !== null) {
        levels.shift();
        levels.push(s.level);
        const bars = meter.current?.children;
        if (bars) for (let i = 0; i < LEVEL_BARS; i++) (bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.08, levels[i])})`;
      }
      setElapsed((prev) => (Math.floor(prev) === Math.floor(s.elapsed) ? prev : s.elapsed));
      setSilent(s.silent);
    };
    tick();
    const timer = window.setInterval(tick, 66);
    return () => window.clearInterval(timer);
  }, [sample]);
  const transcribe = async () => {
    setTranscribing(true);
    try {
      const audio = await recorder.snapshot();
      if (!audio) return;
      const { text } = await api.transcribeRecording(audio.data, audio.mimetype);
      if (!text.trim()) throw new Error("Nenhuma fala reconhecida na gravação.");
      onTranscript(text.trim());
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  };
  const current = devices.find((d) => d.deviceId === deviceId);
  return (
    <div
      className={`recording${paused ? " recording--paused" : ""}`}
      role="group"
      aria-label="Gravação de mensagem de voz"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          recorder.cancel();
        }
      }}
    >
      <Button variant="ghost" icon={<Trash2 size={18} aria-hidden />} aria-label="Descartar gravação (Esc)" title="Descartar gravação (Esc)" onClick={recorder.cancel} />
      <span className="recording__status" aria-live="polite">
        <span className="recording__dot" aria-hidden />
        <span className="recording__time">{clock(elapsed)}</span>
        <span className="sr-only">{paused ? "Gravação pausada" : "Gravando"}</span>
      </span>
      {paused && preview ? (
        <div className="recording__preview">
          <AudioPlayer key={preview} src={preview} seconds={elapsed} voice onError={() => undefined} />
        </div>
      ) : (
        <div className="recording__meter" aria-hidden ref={meter}>
          {Array.from({ length: LEVEL_BARS }, (_, i) => (
            <span key={i} style={{ transform: "scaleY(0.08)" }} />
          ))}
          {silent && <span className="recording__silent">Sem som. Confira o microfone.</span>}
        </div>
      )}
      {devices.length > 1 && (
        <span className="recording__mic" title={current?.label || "Microfone"}>
          <Mic size={16} aria-hidden />
          <Select
            aria-label="Microfone"
            size="compact"
            searchable={false}
            clearable={false}
            placeholder="Padrão do sistema"
            value={deviceId || null}
            onChange={(v) => void recorder.chooseDevice(v ?? "")}
            options={devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Microfone ${i + 1}` }))}
          />
        </span>
      )}
      {paused && (
        <Button
          variant="ghost"
          className="recording__ai"
          aria-label="Transcrever com IA e escrever como texto"
          title="Transcrever com IA (vira texto no campo da mensagem)"
          disabled={!preview}
          loading={transcribing}
          icon={<Sparkles size={18} aria-hidden />}
          onClick={() => void transcribe()}
        />
      )}
      <Button
        ref={toggle}
        variant="action"
        className="recording__toggle"
        aria-label={paused ? "Continuar gravando" : "Pausar gravação"}
        title={paused ? "Continuar gravando" : "Pausar (ouça antes de enviar)"}
        icon={paused ? <Mic size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
        onClick={paused ? recorder.resume : recorder.pause}
      />
    </div>
  );
}
