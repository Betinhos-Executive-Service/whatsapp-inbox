// Tirar foto pela câmera do computador e mandar para a bandeja de anexos (passando pelo editor de imagem).
import { Camera, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FormModal } from "./dialogs.tsx";
import { Alert, Button, Select } from "./ds/index.ts";
import { cameraError, photoFileName } from "./camera-utils.ts";

const CAMERA_KEY = "inbox.camera";

const savedCamera = (): string => {
  try {
    return localStorage.getItem(CAMERA_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveCamera = (id: string) => {
  try {
    localStorage.setItem(CAMERA_KEY, id);
  } catch {
    // preferência de conveniência
  }
};

export function CameraDialog({ onDone, onClose }: { onDone: (file: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<{ value: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState(savedCamera);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    let alive = true;
    setReady(false);
    setError(null);
    const open = async () => {
      const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { ...base, deviceId: { exact: deviceId } } : base, audio: false });
      } catch (e) {
        // Câmera salva sumiu: cai no padrão do sistema.
        if (deviceId && e instanceof DOMException && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
          s = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
        } else throw e;
      }
      if (!alive) return s.getTracks().forEach((t) => t.stop());
      stop();
      stream.current = s;
      if (video.current) video.current.srcObject = s;
      s.getVideoTracks()[0]?.addEventListener("ended", () => alive && setError("A câmera foi desconectada."));
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      if (alive) setDevices(list.map((d, i) => ({ value: d.deviceId, label: d.label || `Câmera ${i + 1}` })));
    };
    open().catch((e) => alive && setError(cameraError(e)));
    return () => {
      alive = false;
      stop();
    };
  }, [deviceId]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const take = async () => {
    const el = video.current;
    if (!el || !el.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext("2d")?.drawImage(el, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return setError("Não foi possível capturar a foto.");
    const file = new File([blob], photoFileName(), { type: "image/jpeg" });
    setShot({ file, url: URL.createObjectURL(file) });
  };

  return (
    <FormModal
      title="Tirar foto"
      icon={<Camera size={18} aria-hidden />}
      dirty={!!shot}
      busy={false}
      onClose={onClose}
      footer={
        shot ? (
          <>
            <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => setShot(null)}>
              Tirar outra
            </Button>
            <Button variant="primary" onClick={() => onDone(shot.file)}>
              Usar foto
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" icon={<Camera size={16} aria-hidden />} disabled={!ready || !!error} onClick={() => void take()}>
              Tirar foto
            </Button>
          </>
        )
      }
    >
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      <div className="camera">
        {shot ? (
          <img className="camera__preview" src={shot.url} alt="Foto tirada" />
        ) : (
          <>
            <video ref={video} className="camera__preview camera__preview--live" autoPlay muted playsInline onLoadedMetadata={() => setReady(true)} />
            {!ready && !error && (
              <p className="hint camera__loading">
                <LoaderCircle className="spin" size={16} aria-hidden /> Abrindo a câmera…
              </p>
            )}
          </>
        )}
      </div>
      {!shot && devices.length > 1 && (
        <Select
          aria-label="Câmera"
          size="compact"
          searchable={false}
          clearable={false}
          placeholder="Padrão do sistema"
          value={deviceId || null}
          options={devices}
          onChange={(value) => {
            saveCamera(value ?? "");
            setDeviceId(value ?? "");
          }}
        />
      )}
    </FormModal>
  );
}
