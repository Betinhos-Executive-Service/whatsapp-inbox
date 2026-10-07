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
          <button type="button" className="icon-button icon-button--small" aria-label={`Remover ${a.file.name}`} disabled={disabled} onClick={() => onRemove(a.id)}>
            <X size={14} aria-hidden />
          </button>
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
  timer: number;
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
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const [silent, setSilent] = useState(false);
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
    window.clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => undefined);
    clearPreview();
    setRecording(false);
    setPaused(false);
    setElapsed(0);
    setSilent(false);
    setLevels(Array(LEVEL_BARS).fill(0));
  };
  useEffect(
    () => () => {
      if (rec.current?.recorder.state !== "inactive") rec.current?.recorder.stop();
      teardown();
    },
    [],
  );

  const total = (r: Rec) => r.base + (r.since === null ? 0 : performance.now() - r.since);

  /** Nível do microfone, tempo e aviso de silêncio (~15 atualizações/s; intervalo segue rodando com a janela em segundo plano). */
  const loop = (r: Rec) => {
    const data = new Float32Array(r.analyser.fftSize);
    const tick = () => {
      if (rec.current !== r) return;
      const now = performance.now();
      r.analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      // Sem áudio do sistema (gravação direta) não há nível para medir.
      const running = r.since !== null && r.ctx.state === "running";
      if (running) {
        if (rms < SILENCE_LEVEL) r.quietSince ??= now;
        else r.quietSince = null;
        setSilent(r.quietSince !== null && now - r.quietSince > SILENCE_MS);
        // Escala perceptiva: fala normal fica no meio da barra.
        const level = Math.min(1, Math.sqrt(rms) * 2.2);
        setLevels((l) => [...l.slice(1), level]);
      }
      setElapsed(total(r) / 1000);
    };
    r.timer = window.setInterval(tick, 66);
  };

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
    const r: Rec = { ctx, dest, analyser, source, stream, recorder, chunks: [], base: 0, since: performance.now(), quietSince: null, timer: 0 };
    recorder.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    rec.current = r;
    recorder.start(250);
    setRecording(true);
    setPaused(false);
    loop(r);
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
    setSilent(false);
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
      setSilent(false);
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

  return { recording, paused, elapsed, levels, silent, devices, deviceId, preview, start, pause, resume, cancel, finish, chooseDevice };
}

export type Recorder = ReturnType<typeof useRecorder>;

export function RecordingBar({ recorder }: { recorder: Recorder }) {
  const { paused, elapsed, levels, silent, devices, deviceId, preview } = recorder;
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => toggle.current?.focus(), [paused]);
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
      <button type="button" className="icon-button" aria-label="Descartar gravação (Esc)" title="Descartar gravação (Esc)" onClick={recorder.cancel}>
        <Trash2 size={18} aria-hidden />
      </button>
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
        <div className="recording__meter" aria-hidden>
          {levels.map((l, i) => (
            <span key={i} style={{ transform: `scaleY(${Math.max(0.08, l)})` }} />
          ))}
          {silent && <span className="recording__silent">Sem som. Confira o microfone.</span>}
        </div>
      )}
      {devices.length > 1 && (
        <label className="recording__mic" title={current?.label || "Microfone"}>
          <Mic size={16} aria-hidden />
          <span className="sr-only">Microfone</span>
          <select value={deviceId} onChange={(e) => void recorder.chooseDevice(e.target.value)}>
            {!deviceId && <option value="">Padrão do sistema</option>}
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microfone ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        ref={toggle}
        type="button"
        className="icon-button recording__toggle"
        aria-label={paused ? "Continuar gravando" : "Pausar gravação"}
        title={paused ? "Continuar gravando" : "Pausar (ouça antes de enviar)"}
        onClick={paused ? recorder.resume : recorder.pause}
      >
        {paused ? <Mic size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
      </button>
    </div>
  );
}
