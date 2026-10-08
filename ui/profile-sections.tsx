import { BriefcaseBusiness, FileText, HandCoins, Images, MessageCircle, Play, Smile, TriangleAlert, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, mediaUrl, type Message, type Persona } from "./api.ts";
import { aiName, isAiReady, useAiStatus } from "./ai-state.ts";
import { FileViewer, Lightbox, fileSize } from "./media.tsx";
import { Button } from "./ds/index.ts";

const PAGE = 60;
const when = (at: number, time = false) =>
  new Date(at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) });

/** Fotos, vídeos e documentos trocados na conversa, do mais recente ao mais antigo. */
export function MediaSection({ jid }: { jid: string }) {
  const [type, setType] = useState<"visual" | "docs">("visual");
  const [items, setItems] = useState<Message[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Message | null>(null);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError(null);
    api
      .media(jid, type)
      .then((list) => {
        if (!alive) return;
        setItems(list);
        setMore(list.length === PAGE);
      })
      .catch((e: Error) => alive && setError(/não encontrada/i.test(e.message) ? "Sem conversa direta com esta pessoa neste computador." : `Não foi possível carregar as mídias. ${e.message}`));
    return () => {
      alive = false;
    };
  }, [jid, type]);

  const loadMore = async () => {
    if (!items?.length) return;
    setLoadingMore(true);
    try {
      const list = await api.media(jid, type, items[items.length - 1].at);
      setItems((prev) => [...(prev ?? []), ...list.filter((m) => !prev?.some((p) => p.id === m.id))]);
      setMore(list.length === PAGE);
    } catch (e) {
      setError(`Não foi possível carregar mais. ${(e as Error).message}`);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="stack profile__section">
      <div className="profile__section-head">
        <h5 className="eyebrow">
          <Images size={14} aria-hidden /> Mídias
        </h5>
      </div>
      <div className="segmented" role="tablist" aria-label="Tipo de mídia">
        {(
          [
            ["visual", "Fotos e vídeos"],
            ["docs", "Documentos"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" role="tab" className="segmented__item" aria-selected={type === value} onClick={() => setType(value)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="hint hint--warning">{error}</p>}
      {!items && !error && (
        <div className={type === "visual" ? "profile-media" : "stack"} aria-hidden>
          {Array.from({ length: type === "visual" ? 6 : 3 }, (_, i) => (
            <span key={i} className={type === "visual" ? "profile-media__item profile-media__item--skeleton" : "profile-doc profile-doc--skeleton"} />
          ))}
        </div>
      )}
      {items && !items.length && <p className="hint">{type === "visual" ? "Nenhuma foto ou vídeo nesta conversa." : "Nenhum documento nesta conversa."}</p>}
      {items && !!items.length && type === "visual" && (
        <ul className="profile-media">
          {items.map((m) => (
            <li key={m.id}>
              <MediaTile m={m} onOpen={() => setOpen(m)} />
            </li>
          ))}
        </ul>
      )}
      {items && !!items.length && type === "docs" && (
        <ul className="stack profile-docs">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className="profile-doc" onClick={() => setOpen(m)}>
                <span className="media-doc__icon" aria-hidden>
                  <FileText size={18} />
                </span>
                <span className="participant__info">
                  <span className="participant__name" title={m.media?.fileName ?? undefined}>{m.media?.fileName ?? "Documento"}</span>
                  <span className="hint">{[when(m.at), m.media?.size ? fileSize(m.media.size) : null, m.fromMe ? "Enviado" : "Recebido"].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <Button variant="ghost" size="compact" loading={loadingMore} onClick={() => void loadMore()}>
          Ver mais antigos
        </Button>
      )}
      {open && open.media?.type === "image" && <Lightbox m={open} src={mediaUrl(open)} download={mediaUrl(open, true)} onClose={close} />}
      {open && open.media?.type !== "image" && <FileViewer m={open} onClose={close} />}
    </section>
  );
}

function MediaTile({ m, onOpen }: { m: Message; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  const video = m.media?.type === "video";
  const label = `${video ? "Vídeo" : "Foto"} de ${when(m.at)}${m.fromMe ? ", enviado" : ", recebido"}`;
  if (failed) {
    return (
      <span className="profile-media__item profile-media__item--failed" title="Mídia expirada no WhatsApp">
        <TriangleAlert size={16} aria-label={`${label} indisponível`} />
      </span>
    );
  }
  return (
    <button type="button" className="profile-media__item" onClick={onOpen} aria-label={`Abrir ${label}`} title={when(m.at)}>
      {video ? <video src={mediaUrl(m)} preload="metadata" muted onError={() => setFailed(true)} /> : <img src={mediaUrl(m)} alt="" loading="lazy" onError={() => setFailed(true)} />}
      {video && (
        <span className="profile-media__play" aria-hidden>
          <Play size={14} />
        </span>
      )}
    </button>
  );
}

const TOPICS: { key: keyof Pick<Persona, "trabalho" | "comportamento" | "personalidade" | "pagamento" | "atencao">; label: string; icon: ReactNode }[] = [
  { key: "atencao", label: "Pontos de atenção", icon: <TriangleAlert size={14} aria-hidden /> },
  { key: "trabalho", label: "Trabalho", icon: <BriefcaseBusiness size={14} aria-hidden /> },
  { key: "comportamento", label: "Comportamento", icon: <MessageCircle size={14} aria-hidden /> },
  { key: "personalidade", label: "Personalidade", icon: <Smile size={14} aria-hidden /> },
  { key: "pagamento", label: "Pagamento", icon: <HandCoins size={14} aria-hidden /> },
];

/** Perfil da pessoa montado pela IA a partir do histórico. Fica guardado até gerar de novo. */
export function PersonaSection({ jid, name, notify }: { jid: string; name: string; notify: (kind: "error" | "success", text: string) => void }) {
  const ai = useAiStatus();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [checked, setChecked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPersona(null);
    setChecked(false);
    setError(null);
    api
      .persona(jid)
      .then((r) => alive && setPersona(r.persona))
      .catch(() => undefined)
      .finally(() => alive && setChecked(true));
    return () => {
      alive = false;
    };
  }, [jid]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      setPersona((await api.generatePersona(jid)).persona);
    } catch (e) {
      const text = /não encontrada/i.test((e as Error).message) ? "Sem conversa direta com esta pessoa neste computador." : (e as Error).message;
      setError(text);
      notify("error", `A ${aiName(ai)} não gerou o perfil. ${text}`);
    } finally {
      setGenerating(false);
    }
  };

  const ready = isAiReady(ai);
  return (
    <section className="stack profile__section" aria-labelledby="persona-title">
      <div className="profile__section-head">
        <h5 id="persona-title" className="eyebrow">
          <WandSparkles size={14} aria-hidden /> Perfil pela IA
        </h5>
      </div>
      {persona ? (
        <div className="persona">
          {persona.resumo && <p className="persona__lead">{persona.resumo}</p>}
          {TOPICS.filter((t) => persona[t.key].length).map((t) => (
            <div key={t.key} className={`persona__topic${t.key === "atencao" ? " persona__topic--alert" : ""}`}>
              <h6 className="persona__title">
                {t.icon} {t.label}
              </h6>
              <ul className="persona__list">
                {persona[t.key].map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
          <span className="hint">
            Gerado em {when(persona.at, true)} a partir de {persona.messages} mensagens. Confira antes de usar: a IA pode errar.
          </span>
        </div>
      ) : (
        checked && (
          <p className="hint">
            {ready
              ? `Lê o histórico com ${name} e destaca trabalho, comportamento, personalidade, pagamento e pontos de atenção.${ai?.provider === "claude" ? " Com o Claude pode levar mais de um minuto." : ""}`
              : "Ative a IA em Configurações › IA para usar."}
          </p>
        )
      )}
      {error && <p className="hint hint--warning">{error}</p>}
      <div className="cluster">
        <Button variant="secondary" size="compact" disabled={!ready || !checked} loading={generating} icon={<WandSparkles size={16} aria-hidden />} onClick={() => void generate()}>
          {generating ? "Gerando perfil…" : persona ? "Gerar de novo" : "Gerar perfil com IA"}
        </Button>
      </div>
    </section>
  );
}
