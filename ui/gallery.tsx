import { Play, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, mediaUrl, type Message } from "./api.ts";
import { senderLabel, ViewerShell, when } from "./media.tsx";
import { ZoomableImage, type ZoomableImageHandle } from "./zoomable-image.tsx";

/**
 * Galeria de fotos e vídeos, como no WhatsApp: setas laterais, teclado e tira de miniaturas embaixo.
 * `items` chega do mais recente ao mais antigo (ordem da API); a tira mostra do mais antigo ao mais recente.
 * `loadOlder` busca a página anterior quando a navegação chega ao item mais antigo.
 */
export function MediaGallery({ items, startId, chatName, onClose, loadOlder }: { items: Message[]; startId: string; chatName?: string; onClose: () => void; loadOlder?: (() => Promise<void>) | null }) {
  const strip = useRef<HTMLUListElement>(null);
  const zoomable = useRef<ZoomableImageHandle>(null);
  const [currentId, setCurrentId] = useState(startId);
  const [loading, setLoading] = useState(false);
  /** Pediu o anterior estando no mais antigo: ao chegar a página nova, anda para ele. */
  const wantPrev = useRef(false);

  const list = useMemo(() => [...items].reverse(), [items]);
  const index = Math.max(0, list.findIndex((m) => m.id === currentId));
  const current = list[index];

  const go = useCallback(
    (dir: -1 | 1) => {
      const next = list[index + dir];
      if (next) {
        setCurrentId(next.id);
        return;
      }
      if (dir === -1 && loadOlder && !loading) {
        wantPrev.current = true;
        setLoading(true);
        void loadOlder().finally(() => setLoading(false));
      }
    },
    [list, index, loadOlder, loading],
  );

  useEffect(() => {
    if (wantPrev.current && index > 0) {
      wantPrev.current = false;
      setCurrentId(list[index - 1].id);
    }
  }, [list, index]);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentId]);

  /** Vizinhos já em cache para a troca ser imediata. */
  useEffect(() => {
    for (const m of [list[index - 1], list[index + 1]]) if (m?.media?.type === "image") new Image().src = mediaUrl(m);
  }, [list, index]);

  if (!current) return null;
  const video = current.media?.type === "video";
  return (
    <ViewerShell
      m={current}
      label="Fotos e vídeos da conversa"
      title={senderLabel(current, chatName)}
      meta={when(current.at)}
      onClose={onClose}
      onKey={(e) => !!zoomable.current?.key(e)}
      nav={{ prev: (index > 0 || loadOlder) && !loading ? () => go(-1) : null, next: index < list.length - 1 ? () => go(1) : null, position: `${index + 1} de ${list.length}${loadOlder ? "+" : ""}` }}
      footer={
        list.length > 1 && (
          <ul ref={strip} className="gallery__strip" aria-label="Miniaturas">
            {list.map((m, i) => (
              <li key={m.id}>
                <Thumb m={m} active={i === index} onPick={() => setCurrentId(m.id)} />
              </li>
            ))}
          </ul>
        )
      }
    >
      {video ? (
        <div className="viewer-shell__center">
          <video key={current.id} className="viewer-shell__media" src={mediaUrl(current)} controls autoPlay preload="metadata" />
        </div>
      ) : (
        <ZoomableImage key={current.id} ref={zoomable} src={mediaUrl(current)} />
      )}
    </ViewerShell>
  );
}

function Thumb({ m, active, onPick }: { m: Message; active: boolean; onPick: () => void }) {
  const [failed, setFailed] = useState(false);
  const video = m.media?.type === "video";
  return (
    <button type="button" className={`gallery__thumb${active ? " gallery__thumb--active" : ""}`} aria-current={active || undefined} aria-label={`${video ? "Vídeo" : "Foto"} de ${when(m.at)}`} onClick={onPick}>
      {failed ? (
        <TriangleAlert size={16} aria-hidden />
      ) : video ? (
        <video src={mediaUrl(m)} preload="metadata" muted onError={() => setFailed(true)} />
      ) : (
        <img src={mediaUrl(m)} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
      {video && !failed && (
        <span className="profile-media__play gallery__play" aria-hidden>
          <Play size={10} />
        </span>
      )}
    </button>
  );
}

const PAGE = 60;
/** Quantas páginas voltar procurando a mensagem aberta antes de desistir e mostrá-la sozinha. */
const MAX_SEEK = 8;

/** Galeria aberta de uma bolha: carrega as fotos e vídeos da conversa e posiciona na mensagem clicada. */
export function ChatGallery({ m, onClose }: { m: Message; onClose: () => void }) {
  const [items, setItems] = useState<Message[]>([m]);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let acc: Message[] = [];
      let before: number | undefined;
      let hasMore = false;
      for (let page = 0; page < MAX_SEEK; page++) {
        const list = await api.media(m.chatJid, "visual", before);
        acc = [...acc, ...list];
        hasMore = list.length === PAGE;
        if (acc.some((x) => x.id === m.id) || !hasMore) break;
        before = list[list.length - 1].at;
      }
      if (!alive) return;
      if (!acc.some((x) => x.id === m.id)) acc = [m];
      setItems(acc);
      setMore(hasMore);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [m]);

  const loadOlder = useCallback(async () => {
    const last = items[items.length - 1];
    const list = await api.media(m.chatJid, "visual", last.at);
    setItems((prev) => [...prev, ...list.filter((x) => !prev.some((p) => p.id === x.id))]);
    setMore(list.length === PAGE);
  }, [items, m.chatJid]);

  return <MediaGallery items={items} startId={m.id} onClose={onClose} loadOlder={more ? loadOlder : null} />;
}
