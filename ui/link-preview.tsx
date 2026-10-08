import { memo, useEffect, useState } from "react";
import { api, type LinkPreview } from "./api.ts";

// Uma busca por link durante a sessão; a lista re-renderiza muito.
const cache = new Map<string, Promise<LinkPreview | null>>();
function load(url: string) {
  let hit = cache.get(url);
  if (!hit) {
    hit = api.linkPreview(url).catch(() => null);
    cache.set(url, hit);
  }
  return hit;
}

/** Cartão do link (título, descrição e imagem), como no WhatsApp. Some se o site não tiver prévia. */
export const LinkCard = memo(function LinkCard({ url }: { url: string }) {
  const [data, setData] = useState<LinkPreview | null>(null);
  const [imageOk, setImageOk] = useState(true);
  useEffect(() => {
    let alive = true;
    setData(null);
    setImageOk(true);
    void load(url).then((p) => alive && setData(p));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!data) return null;
  return (
    <a className="link-card" href={url} target="_blank" rel="noopener noreferrer" title={url}>
      {data.image && imageOk && <img className="link-card__image" src={data.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageOk(false)} />}
      <span className="link-card__body">
        <span className="link-card__title">{data.title}</span>
        {data.description && <span className="link-card__desc">{data.description}</span>}
        <span className="link-card__site">{data.site}</span>
      </span>
    </a>
  );
});
