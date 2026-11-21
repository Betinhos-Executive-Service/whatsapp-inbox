import { FileText, Link as LinkIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MediaFilter, type MediaGroup, type Message } from "./api.ts";
import { FileViewer, fileSize, senderLabel, useDialog, when } from "./media.tsx";
import { MediaGallery } from "./gallery.tsx";
import { MediaTile } from "./profile-sections.tsx";
import { Button, SearchBox } from "./ds/index.ts";

const PAGE = 60;
const TABS: [MediaGroup, string][] = [
  ["visual", "Fotos e vídeos"],
  ["docs", "Documentos"],
  ["links", "Links"],
];
const FROM: [MediaFilter["from"], string][] = [
  [undefined, "Todos"],
  ["me", "Enviados"],
  ["them", "Recebidos"],
];
const PLACEHOLDER: Record<MediaGroup, string> = { visual: "Buscar na legenda", docs: "Buscar pelo nome do arquivo", links: "Buscar nos links" };
const EMPTY: Record<MediaGroup, string> = { visual: "Nenhuma foto ou vídeo", docs: "Nenhum documento", links: "Nenhum link" };

const month = (at: number) => new Date(at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", month: "long", year: "numeric" });
const LINK = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const linksIn = (text: string) => [...text.matchAll(LINK)].map((r) => r[0].replace(/[.,;:!?)\]]+$/, ""));
const host = (url: string) => {
  try {
    return new URL(url.startsWith("www.") ? `https://${url}` : url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Mensagens agrupadas por mês, na ordem em que chegaram (mais recente primeiro). */
function byMonth(items: Message[]) {
  const groups: { label: string; items: Message[] }[] = [];
  for (const m of items) {
    const label = month(m.at);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(m);
  }
  return groups;
}

/** Fotos, vídeos, documentos e links da conversa, numa tela própria, com busca e filtro enviado/recebido no servidor. */
export function ChatMediaPanel({ jid, chatName, initialTab = "visual", onClose }: { jid: string; chatName: string; initialTab?: MediaGroup; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<MediaGroup>(initialTab);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState<MediaFilter["from"]>(undefined);
  const [items, setItems] = useState<Message[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Message | null>(null);
  /** Muda a cada busca nova: a página "mais antigos" de uma busca anterior é descartada. */
  const search = useRef(0);
  const group = jid.endsWith("@g.us");
  useDialog(panel, close, onClose);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    search.current++;
    setItems(null);
    setError(null);
    api
      .media(jid, tab, undefined, { q, from })
      .then((list) => {
        if (!alive) return;
        setItems(list);
        setMore(list.length === PAGE);
      })
      .catch((e: Error) => alive && setError(`Não foi possível carregar. ${e.message}`));
    return () => {
      alive = false;
    };
  }, [jid, tab, q, from]);

  const loadMore = async () => {
    if (!items?.length) return;
    const mine = search.current;
    setLoadingMore(true);
    try {
      const list = await api.media(jid, tab, items[items.length - 1].at, { q, from });
      if (mine !== search.current) return;
      setItems((prev) => [...(prev ?? []), ...list.filter((m) => !prev?.some((p) => p.id === m.id))]);
      setMore(list.length === PAGE);
    } catch (e) {
      if (mine === search.current) setError(`Não foi possível carregar mais. ${(e as Error).message}`);
    } finally {
      setLoadingMore(false);
    }
  };

  const groups = useMemo(() => (items ? byMonth(items) : []), [items]);
  const who = (m: Message) => (group || m.fromMe ? senderLabel(m, chatName) : null);
  const filtered = !!q || !!from;

  return (
    <div className="modal chat-media" role="dialog" aria-modal="true" aria-label={`Mídias de ${chatName}`}>
      <div className="modal__overlay" onClick={onClose} />
      <div ref={panel} className="modal__panel surface chat-media__panel">
        <header className="chat-media__head">
          <h2 className="heading-card chat-media__title">
            Mídias <span>· {chatName}</span>
          </h2>
          <Button ref={close} variant="ghost" size="compact" icon={<X size={18} aria-hidden />} aria-label="Fechar (Esc)" title="Fechar (Esc)" onClick={onClose} />
        </header>
        <div className="segmented chat-media__tabs" role="tablist" aria-label="Tipo de mídia">
          {TABS.map(([value, label]) => (
            <button key={value} type="button" role="tab" className="segmented__item" aria-selected={tab === value} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chat-media__tools">
          <SearchBox size="compact" aria-label={PLACEHOLDER[tab]} placeholder={PLACEHOLDER[tab]} value={query} onChange={setQuery} />
          <div className="segmented" role="radiogroup" aria-label="Quem enviou">
            {FROM.map(([value, label]) => (
              <button key={label} type="button" role="radio" className="segmented__item" aria-checked={from === value} onClick={() => setFrom(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="chat-media__body">
          {error && <p className="hint hint--warning">{error}</p>}
          {!items && !error && (
            <div className={tab === "visual" ? "profile-media" : "stack"} aria-hidden>
              {Array.from({ length: tab === "visual" ? 12 : 5 }, (_, i) => (
                <span key={i} className={tab === "visual" ? "profile-media__item profile-media__item--skeleton" : "profile-doc profile-doc--skeleton"} />
              ))}
            </div>
          )}
          {items && !items.length && <p className="hint chat-media__empty">{EMPTY[tab]}{filtered ? " com esse filtro." : " nesta conversa."}</p>}
          {groups.map((g) => (
            <section key={g.label} className="chat-media__month" aria-label={g.label}>
              <h3 className="eyebrow chat-media__month-label">{g.label}</h3>
              {tab === "visual" ? (
                <ul className="profile-media chat-media__grid">
                  {g.items.map((m) => (
                    <li key={m.id}>
                      <MediaTile m={m} onOpen={() => setOpen(m)} />
                    </li>
                  ))}
                </ul>
              ) : tab === "docs" ? (
                <ul className="stack profile-docs">
                  {g.items.map((m) => (
                    <li key={m.id}>
                      <button type="button" className="profile-doc" onClick={() => setOpen(m)}>
                        <span className="media-doc__icon" aria-hidden>
                          <FileText size={18} />
                        </span>
                        <span className="participant__info">
                          <span className="participant__name" title={m.media?.fileName ?? undefined}>{m.media?.fileName ?? "Documento"}</span>
                          <span className="hint">{[who(m) ?? "Recebido", when(m.at), m.media?.size ? fileSize(m.media.size) : null].filter(Boolean).join(" · ")}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="stack profile-docs">
                  {g.items.flatMap((m) =>
                    linksIn(m.text).map((url, i) => (
                      <li key={`${m.id}-${i}`}>
                        <a className="profile-doc" href={url.startsWith("www.") ? `https://${url}` : url} target="_blank" rel="noopener noreferrer" title={url}>
                          <span className="media-doc__icon" aria-hidden>
                            <LinkIcon size={18} />
                          </span>
                          <span className="participant__info">
                            <span className="participant__name">{host(url)}</span>
                            <span className="chat-media__url">{url}</span>
                            <span className="hint">{[who(m) ?? "Recebido", when(m.at)].join(" · ")}</span>
                          </span>
                        </a>
                      </li>
                    )),
                  )}
                </ul>
              )}
            </section>
          ))}
          {more && (
            <Button variant="ghost" size="compact" loading={loadingMore} onClick={() => void loadMore()}>
              Carregar mais antigos
            </Button>
          )}
        </div>
      </div>
      {open && tab === "visual" && items && <MediaGallery items={items} startId={open.id} chatName={chatName} onClose={() => setOpen(null)} loadOlder={more ? loadMore : null} />}
      {open && tab === "docs" && items && <FileViewer m={open} items={items} chatName={chatName} onClose={() => setOpen(null)} />}
    </div>
  );
}
