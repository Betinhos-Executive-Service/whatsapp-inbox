import { Download, FileText, Mic, Pause, Play, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl, type Message, type OutgoingMedia } from "./api.ts";
import { webmToOgg } from "./ogg.ts";

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
      <button type="button" className="audio__play" onClick={toggle} aria-label={isPlaying ? "Pausar áudio" : "Tocar áudio"} aria-busy={loading || undefined}>
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

function Lightbox({ src, download, onClose }: { src: string; download: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Imagem ampliada" onClick={onClose}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="lightbox__actions" onClick={(e) => e.stopPropagation()}>
        <a className="button button--secondary" href={download} download>
          <Download size={16} aria-hidden /> Baixar
        </a>
        <button ref={close} className="button button--primary" onClick={onClose}>
          <X size={16} aria-hidden /> Fechar
        </button>
      </div>
    </div>
  );
}

export function MediaView({ m, caption }: { m: Message; caption: string }) {
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const closeZoom = useCallback(() => setZoom(false), []);
  const media = m.media!;
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
        {zoom && <Lightbox src={src} download={mediaUrl(m, true)} onClose={closeZoom} />}
      </>
    );
  }
  if (media.type === "video") return <video className="media-video" src={src} controls preload="metadata" onError={() => setFailed(true)} />;
  if (media.type === "audio") return <AudioPlayer src={src} seconds={media.seconds} voice={media.ptt} onError={() => setFailed(true)} />;
  const ext = (media.fileName?.split(".").pop() ?? media.mimetype.split("/").pop() ?? "").slice(0, 4).toUpperCase();
  return (
    <a className="media-doc" href={mediaUrl(m, true)} download>
      <span className="media-doc__icon" aria-hidden>
        <FileText size={20} />
      </span>
      <span className="media-doc__info">
        <span className="media-doc__name">{media.fileName ?? "Documento"}</span>
        <span className="hint">{[ext, media.size ? fileSize(media.size) : null].filter(Boolean).join(" · ")}</span>
      </span>
      <Download size={16} aria-hidden />
    </a>
  );
}

// ---- Envio

export type Attachment = { id: number; file: File; preview: string | null };

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
          <button type="button" className="icon-button icon-button--small" aria-label={`Remover ${a.file.name}`} disabled={disabled} onClick={() => onRemove(a.id)}>
            <X size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Grava mensagem de voz pelo microfone; entrega Ogg/Opus pronto para o WhatsApp. */
export function useRecorder(onError: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; timer: number } | null>(null);

  const stopAll = () => {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setRecording(false);
    setElapsed(0);
  };
  useEffect(() => () => {
    if (rec.current?.recorder.state === "recording") rec.current.recorder.stop();
    stopAll();
  }, []);

  const start = async () => {
    if (rec.current) return;
    const mime = "audio/webm;codecs=opus";
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported(mime)) return onError("Este computador não grava áudio em Opus.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return onError("Microfone indisponível. Confira se ele está conectado e liberado para o app.");
    }
    const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    rec.current = { recorder, stream, chunks, started, timer };
    recorder.start(250);
    setRecording(true);
  };

  const cancel = () => {
    if (rec.current?.recorder.state === "recording") rec.current.recorder.stop();
    stopAll();
  };

  /** Para e devolve o anexo de voz, ou null se curto demais. */
  const finish = async (): Promise<OutgoingMedia | null> => {
    const r = rec.current;
    if (!r) return null;
    const stopped = new Promise<void>((resolve) => (r.recorder.onstop = () => resolve()));
    r.recorder.stop();
    await stopped;
    const chunks = r.chunks;
    stopAll();
    const webm = new Uint8Array(await new Blob(chunks).arrayBuffer());
    const { ogg, seconds } = webmToOgg(webm);
    if (seconds < 0.5) return null;
    return { fileName: "voz.ogg", mimetype: "audio/ogg", data: base64(ogg), ptt: true, seconds };
  };

  return { recording, elapsed, start, cancel, finish };
}

export function RecordingBar({ elapsed, onCancel }: { elapsed: number; onCancel: () => void }) {
  return (
    <div className="recording" role="status" aria-live="off">
      <button type="button" className="icon-button" aria-label="Descartar gravação" onClick={onCancel}>
        <Trash2 size={18} aria-hidden />
      </button>
      <span className="recording__dot" aria-hidden />
      <span className="recording__time">{clock(elapsed)}</span>
      <span className="hint">Gravando mensagem de voz</span>
    </div>
  );
}
