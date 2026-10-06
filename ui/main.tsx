import {
  AlarmClock,
  ArrowLeft,
  CheckCircle2,
  Download,
  CircleDot,
  Clock,
  Inbox,
  LoaderCircle,
  MessageSquareText,
  Search,
  SendHorizontal,
  Settings,
  Smartphone,
  Sparkles,
  WandSparkles,
  StickyNote,
  Zap,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { priorityLevel, priorityScore } from "./priority.ts";
import { mediaUrl, api, type AppState, type Chat, type Connection, type Message, type QuickReply, type Status } from "./api.ts";
import { NotesPanel, reminderLabel } from "./notes.tsx";
import { aiName, isAiReady, publishAi, useAiStatus } from "./ai-state.ts";
import { fillQuickReply, quickQuery, QuickReplyMenu } from "./quick.tsx";
import { dayLabel, formatBuild, formatTime, initials, listTime, normalize, percent, sameDay } from "./format.ts";
// Configurações só carregam na primeira abertura: menos JS para interpretar ao iniciar.
const SettingsDrawer = lazy(() => import("./settings.tsx").then((m) => ({ default: m.SettingsDrawer })));
import { UpdateDialog } from "./update.tsx";
import { desktop } from "./desktop.ts";
import "./app.css";

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

type Tab = Status | "todas";
const TABS: { id: Tab; label: string }[] = [
  { id: "aberta", label: "Abertas" },
  { id: "aguardando", label: "Aguardando" },
  { id: "resolvida", label: "Resolvidas" },
  { id: "todas", label: "Todas" },
];
const STATUS_META: Record<Status, { label: string; icon: ReactNode }> = {
  aberta: { label: "Aberta", icon: <CircleDot size={16} aria-hidden /> },
  aguardando: { label: "Aguardando", icon: <Clock size={16} aria-hidden /> },
  resolvida: { label: "Resolvida", icon: <CheckCircle2 size={16} aria-hidden /> },
};
const PAGE = 200;

type Toast = { id: number; kind: "error" | "success"; text: string };

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    if (kind === "success") setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          {t.kind === "error" ? <TriangleAlert size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
          <span>{t.text}</span>
          <button className="icon-button icon-button--plain" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function ConnectionPill({ connection, online }: { connection: Connection; online: boolean }) {
  if (!online) {
    return (
      <span className="pill pill--danger">
        <WifiOff size={14} aria-hidden /> App desligado
      </span>
    );
  }
  const map: Record<Connection["status"], [string, string]> = {
    conectado: ["success", "Conectado"],
    qr: ["warning", "Aguardando QR"],
    iniciando: ["neutral", "Iniciando"],
    reconectando: ["warning", "Reconectando"],
    desconectado: ["danger", "Desconectado"],
  };
  const [tone, label] = map[connection.status];
  return (
    <span className={`pill pill--${tone}`}>
      <span className="pill__dot" aria-hidden /> {label}
    </span>
  );
}

function ConnectScreen({ connection, onSkip }: { connection: Connection; onSkip: () => void }) {
  return (
    <div className="connect">
      <div className="surface connect__card">
        <div className="connect__icon">
          <Smartphone size={24} aria-hidden />
        </div>
        <h2 className="heading-detail">Conecte seu WhatsApp</h2>
        <ol className="connect__steps">
          <li>Abra o WhatsApp no celular.</li>
          <li>Toque em Mais opções ou Configurações e depois em Aparelhos conectados.</li>
          <li>Toque em Conectar aparelho e aponte a câmera para o código.</li>
        </ol>
        {connection.qr ? (
          <img className="connect__qr" src={connection.qr} alt="Código QR para conectar o WhatsApp" width={280} height={280} />
        ) : (
          <div className="connect__qr connect__qr--loading" aria-busy="true">
            <LoaderCircle className="spin" size={24} aria-hidden />
            <span>Gerando código…</span>
          </div>
        )}
        {connection.error && <p className="hint hint--warning">{connection.error}</p>}
        <p className="hint">O código muda a cada poucos segundos. Ele aparece aqui sozinho.</p>
        <button className="button button--ghost" onClick={onSkip}>
          Ver conversas salvas
        </button>
      </div>
    </div>
  );
}

/** Memo: chegada de mensagem numa conversa não redesenha as outras 200 da lista. */
const ChatItem = memo(function ChatItem({ chat, selected, onOpen }: { chat: Chat; selected: boolean; onOpen: (jid: string) => void }) {
  const urgent = (chat.ai?.urgent ?? 0) >= 0.5;
  const reminderDue = chat.reminderAt !== null && chat.reminderAt <= Date.now();
  const level = priorityLevel(priorityScore(chat));
  // Prioridade dita pela IA aparece sempre; "baixa" só quando não há nada mais relevante.
  const aiPriority = chat.ai?.priority ?? null;
  const showPriority = !!aiPriority && chat.status !== "resolvida" && (aiPriority !== "baixa" || (!level && !urgent && chat.reminderAt === null));
  return (
    <li>
      <button className="chat-item" aria-current={selected ? "true" : undefined} onClick={() => onOpen(chat.jid)}>
        <span className="avatar" aria-hidden>
          {initials(chat.name)}
        </span>
        <span className="chat-item__body">
          <span className="chat-item__row">
            <span className="chat-item__name">{chat.name}</span>
            <span className={`chat-item__time${chat.unread ? " chat-item__time--unread" : ""}`}>{listTime(chat.lastAt)}</span>
          </span>
          <span className="chat-item__row">
            <span className="chat-item__preview">
              {chat.lastFromMe && <span className="chat-item__me">Você: </span>}
              {chat.lastText ?? "Sem mensagens"}
            </span>
            {chat.unread > 0 && (
              <span className="count" aria-label={`${chat.unread} não lidas`}>
                {chat.unread > 99 ? "99+" : chat.unread}
              </span>
            )}
          </span>
          {(chat.label || urgent || chat.reminderAt !== null || level || showPriority) && (
            <span className="chat-item__tags">
              {showPriority && aiPriority && <span className={`badge ${PRIORITY_META[aiPriority].cls}`}>{PRIORITY_META[aiPriority].text}</span>}
              {level && !urgent && !showPriority && (
                <span className={`badge ${level === "alta" ? "badge--danger" : "badge--warning"}`}>
                  {level === "alta" ? "Responder já" : "Responder hoje"}
                </span>
              )}
              {chat.label && <span className="badge badge--info">{chat.label}</span>}
              {urgent && (
                <span className="badge badge--danger">
                  <TriangleAlert size={12} aria-hidden /> Urgente
                </span>
              )}
              {chat.reminderAt !== null && (
                <span className={`badge ${reminderDue ? "badge--warning" : "badge--neutral"}`}>
                  <AlarmClock size={12} aria-hidden /> {reminderDue ? "Lembrete agora" : reminderLabel(chat.reminderAt)}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    </li>
  );
});

/** Texto de busca já normalizado, uma vez por versão da conversa (objeto novo a cada mudança). */
const searchCache = new WeakMap<Chat, string>();
function searchText(c: Chat): string {
  let s = searchCache.get(c);
  if (s === undefined) searchCache.set(c, (s = normalize(`${c.name} ${c.phone ?? ""} ${c.lastText ?? ""} ${c.note ?? ""}`)));
  return s;
}

function ChatList(props: {
  chats: Chat[];
  labels: string[];
  selected: string | null;
  onOpen: (jid: string) => void;
  connection: Connection;
  online: boolean;
  onSettings: () => void;
  loaded: boolean;
}) {
  const [tab, setTab] = useState<Tab>("aberta");
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  // A digitação responde na hora; o filtro de milhares de conversas vem logo depois.
  const deferredQuery = useDeferredValue(query);
  const [limit, setLimit] = useState(PAGE);
  const [order, setOrder] = useState<"recentes" | "prioridade">(() => {
    try {
      return localStorage.getItem("inbox:order") === "prioridade" ? "prioridade" : "recentes";
    } catch {
      return "recentes";
    }
  });
  const chooseOrder = (o: "recentes" | "prioridade") => {
    setOrder(o);
    try {
      localStorage.setItem("inbox:order", o);
    } catch {
      // preferência só deste computador
    }
  };

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { aberta: 0, aguardando: 0, resolvida: 0, todas: props.chats.length };
    for (const chat of props.chats) c[chat.status]++;
    return c;
  }, [props.chats]);

  const filtered = useMemo(() => {
    const q = normalize(deferredQuery.trim());
    const list = props.chats.filter(
      (c) =>
        (tab === "todas" || c.status === tab) &&
        (!label || (label === "__none" ? !c.label : c.label === label)) &&
        (!q || searchText(c).includes(q)),
    );
    if (order === "prioridade") {
      const now = Date.now();
      return list
        .map((c) => ({ c, s: priorityScore(c, now) }))
        .sort((a, b) => b.s - a.s || b.c.lastAt - a.c.lastAt)
        .map((x) => x.c);
    }
    return list;
  }, [props.chats, tab, label, deferredQuery, order]);

  useEffect(() => setLimit(PAGE), [tab, label, query]);

  return (
    <section className="list-pane" aria-label="Conversas">
      <header className="list-pane__header">
        <div className="split">
          <h1 className="heading-page">Conversas</h1>
          <button className="icon-button" aria-label="Abrir configurações" title="Configurações" onClick={props.onSettings}>
            <Settings size={18} aria-hidden />
          </button>
        </div>
        <ConnectionPill connection={props.connection} online={props.online} />
        <label className="search">
          <Search size={16} aria-hidden />
          <span className="sr-only">Buscar conversa</span>
          <input type="search" placeholder="Nome, número ou mensagem" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="segmented" role="tablist" aria-label="Status da conversa">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className="segmented__item" onClick={() => setTab(t.id)}>
              {t.label} <span className="segmented__count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="list-pane__filters">
        <label className="field field--inline">
          <span className="sr-only">Filtrar por etiqueta</span>
          <select value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="">Todas as etiquetas</option>
            <option value="__none">Sem etiqueta</option>
            {props.labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span className="sr-only">Ordenar conversas</span>
          <select value={order} onChange={(e) => chooseOrder(e.target.value as "recentes" | "prioridade")}>
            <option value="recentes">Mais recentes</option>
            <option value="prioridade">Responder primeiro</option>
          </select>
        </label>
        </div>
      </header>
      <div className="list-pane__scroll">
        {!props.loaded ? (
          <ul className="chat-list" aria-busy="true" aria-label="Carregando conversas">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="chat-item chat-item--skeleton" aria-hidden />
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <Inbox size={36} aria-hidden />
            <p className="empty__title">{props.chats.length ? "Nenhuma conversa nestes filtros" : "Nenhuma conversa ainda"}</p>
            <p className="hint">
              {props.chats.length
                ? "Troque a aba de status, a etiqueta ou a busca."
                : "Conecte o WhatsApp. As conversas aparecem aqui conforme chegam."}
            </p>
          </div>
        ) : (
          <ul className="chat-list">
            {filtered.slice(0, limit).map((c) => (
              <ChatItem key={c.jid} chat={c} selected={c.jid === props.selected} onOpen={props.onOpen} />
            ))}
          </ul>
        )}
        {filtered.length > limit && (
          <button className="button button--ghost button--full" onClick={() => setLimit((l) => l + PAGE)}>
            Mostrar mais {Math.min(PAGE, filtered.length - limit)}
          </button>
        )}
      </div>
    </section>
  );
}

const PRIORITY_META = {
  alta: { text: "Prioridade alta", cls: "badge--danger" },
  media: { text: "Prioridade média", cls: "badge--warning" },
  baixa: { text: "Prioridade baixa", cls: "badge--neutral" },
} as const;

function ClassificationBar({ chat, labels, onChange, onClassify, classifying, jevReady, classifierName }: {
  chat: Chat;
  labels: string[];
  onChange: (patch: { status?: Status; label?: string | null }) => void;
  onClassify: () => void;
  classifying: boolean;
  jevReady: boolean;
  classifierName: string;
}) {
  return (
    <div className="classify">
      <div className="segmented segmented--status" role="radiogroup" aria-label="Status da conversa">
        {(Object.keys(STATUS_META) as Status[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={chat.status === s}
            className="segmented__item"
            onClick={() => chat.status !== s && onChange({ status: s })}
          >
            {STATUS_META[s].icon}
            <span>{STATUS_META[s].label}</span>
          </button>
        ))}
      </div>
      <label className="field field--inline field--label">
        <span className="sr-only">Etiqueta</span>
        <select value={chat.label ?? ""} onChange={(e) => onChange({ label: e.target.value || null })}>
          <option value="">Sem etiqueta</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button button--secondary button--compact"
        onClick={onClassify}
        disabled={classifying || !jevReady}
        aria-busy={classifying || undefined}
        title={jevReady ? `Pedir ao ${classifierName} para classificar esta conversa` : "Configure a chave do Jev ou da DeepSeek em Configurações › IA"}
      >
        {classifying ? <LoaderCircle className="spin" size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
        Classificar com {classifierName}
      </button>
      {chat.ai && (
        <p className="classify__ai">
          <Sparkles size={14} aria-hidden />
          <span>
            IA: <strong>{chat.ai.label}</strong> ({percent(chat.ai.confidence)})
            {chat.ai.priority && ` · ${PRIORITY_META[chat.ai.priority].text.toLowerCase()}`}
            {chat.ai.needsReply >= 0.5 && " · espera resposta"}
            {chat.ai.urgent >= 0.5 && " · urgente"}
            {chat.labelSource === "manual" && chat.label !== chat.ai.label && " · etiqueta escolhida por você"}
            {chat.ai.reason && <> · {chat.ai.reason}</>}
          </span>
        </p>
      )}
      {chat.aiError && <p className="classify__ai classify__ai--error">{chat.aiError}</p>}
    </div>
  );
}

function MediaView({ m }: { m: Message }) {
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
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
    return (
      <>
        <button className="media-thumb" onClick={() => setZoom(true)} aria-label="Ampliar imagem">
          <img src={src} alt={m.text.replace(/^\[[^\]]+\]\s*/, "") || "Imagem recebida"} loading="lazy" onError={() => setFailed(true)} className={media.type === "sticker" ? "media-sticker" : undefined} />
        </button>
        {zoom && (
          <div className="lightbox" role="dialog" aria-modal="true" aria-label="Imagem ampliada" onClick={() => setZoom(false)} onKeyDown={(e) => e.key === "Escape" && setZoom(false)}>
            <img src={src} alt="" />
            <div className="lightbox__actions">
              <a className="button button--secondary" href={mediaUrl(m, true)} download onClick={(e) => e.stopPropagation()}>
                Baixar
              </a>
              <button className="button button--primary" autoFocus onClick={() => setZoom(false)}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </>
    );
  }
  if (media.type === "video") return <video className="media-video" src={src} controls preload="none" onError={() => setFailed(true)} />;
  if (media.type === "audio") return <audio className="media-audio" src={src} controls preload="none" onError={() => setFailed(true)} />;
  return (
    <a className="media-doc" href={mediaUrl(m, true)} download>
      <Download size={16} aria-hidden />
      <span>{media.fileName ?? "Documento"}</span>
      {media.size ? <span className="hint">{Math.max(1, Math.round(media.size / 1024))} KB</span> : null}
    </a>
  );
}

/** Memo: digitar no campo de mensagem não redesenha o histórico inteiro. */
const Messages = memo(function Messages({ messages, hasMore, onMore, loadingMore }: { messages: Message[]; hasMore: boolean; onMore: () => void; loadingMore: boolean }) {
  return (
    <>
      {hasMore && (
        <button className="button button--ghost button--compact messages__more" onClick={onMore} disabled={loadingMore} aria-busy={loadingMore || undefined}>
          {loadingMore && <LoaderCircle className="spin" size={16} aria-hidden />}
          Carregar mensagens anteriores
        </button>
      )}
      {messages.map((m, i) => (
        <div key={m.id} className="message-row">
          {(i === 0 || !sameDay(messages[i - 1].at, m.at)) && <div className="day">{dayLabel(m.at)}</div>}
          <div className={`bubble${m.fromMe ? " bubble--me" : ""}${m.kind !== "text" ? " bubble--media" : ""}`}>
            {m.media && <MediaView m={m} />}
            {(!m.media || m.text.replace(/^\[[^\]]+\]\s*/, "")) && (
              <p className="bubble__text">{m.media ? m.text.replace(/^\[[^\]]+\]\s*/, "") : m.text}</p>
            )}
            <time className="bubble__time" dateTime={new Date(m.at).toISOString()}>
              {formatTime(m.at)}
            </time>
          </div>
        </div>
      ))}
    </>
  );
});

function ChatView({ chat, labels, connected, jevReady, classifierName, onBack, notify, onChat, quickReplies, onSetupAi }: {
  chat: Chat;
  onSetupAi: () => void;
  quickReplies: QuickReply[];
  labels: string[];
  connected: boolean;
  jevReady: boolean;
  classifierName: string;
  onBack: () => void;
  notify: (kind: Toast["kind"], text: string) => void;
  onChat: (chat: Chat) => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [quickActive, setQuickActive] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const ai = useAiStatus();
  const aiReady = isAiReady(ai);
  const [drafting, setDrafting] = useState(false);
  const suggest = async () => {
    if (draft.trim() && !window.confirm("Trocar o texto que você já escreveu pela sugestão da IA?")) return;
    setDrafting(true);
    try {
      const { text } = await api.draft(chat.jid);
      setDraft(text);
      requestAnimationFrame(() => composer.current?.focus());
    } catch (e) {
      notify("error", `A ${aiName(ai)} não sugeriu resposta. ${(e as Error).message}`);
    } finally {
      setDrafting(false);
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffset = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    setDraft("");
    stickToBottom.current = true;
    api
      .messages(chat.jid)
      .then((list) => {
        if (!alive) return;
        setMessages(list);
        setHasMore(list.length >= 80);
      })
      .catch((e) => alive && notify("error", e.message));
    return () => {
      alive = false;
    };
  }, [chat.jid, notify]);

  // Mensagem nova chegando nesta conversa (SSE) vira evento no window.
  useEffect(() => {
    const onMessage = (e: Event) => {
      const m = (e as CustomEvent<Message>).detail;
      if (m.chatJid !== chat.jid) return;
      const el = scroller.current;
      stickToBottom.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setMessages((list) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list));
    };
    window.addEventListener("inbox:message", onMessage);
    return () => window.removeEventListener("inbox:message", onMessage);
  }, [chat.jid]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (chat.unread > 0) api.read(chat.jid).then(onChat).catch(() => undefined);
  }, [chat.jid, chat.unread, onChat]);

  // Estável entre renders para o memo de <Messages>; lê a lista atual pela ref.
  const oldestAt = useRef<number | null>(null);
  oldestAt.current = messages?.[0]?.at ?? null;
  const loadMore = useCallback(async () => {
    const before = oldestAt.current;
    if (before === null) return;
    setLoadingMore(true);
    try {
      const older = await api.messages(chat.jid, before);
      keepOffset.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
      setHasMore(older.length >= 80);
      setMessages((list) => [...older, ...(list ?? [])]);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [chat.jid, notify]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    stickToBottom.current = true;
    try {
      onChat(await api.send(chat.jid, text));
      setDraft("");
    } catch (e) {
      notify("error", `Mensagem não enviada. ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  // "/" no começo do campo (ou o botão de raio) abre as respostas rápidas.
  const query = quickQuery(draft);
  const quickItems = quickOpen || query !== null
    ? quickReplies.filter((q) => q.shortcut.startsWith(query ?? "")).slice(0, 8)
    : [];
  const showQuick = quickItems.length > 0;
  useEffect(() => setQuickActive(0), [query, quickOpen]);
  const pickQuick = (q: QuickReply) => {
    setDraft(fillQuickReply(q.text, chat.name));
    setQuickOpen(false);
    requestAnimationFrame(() => composer.current?.focus());
  };

  const change = async (patch: { status?: Status; label?: string | null }) => {
    try {
      onChat(await api.update(chat.jid, patch));
    } catch (e) {
      notify("error", `Não foi possível atualizar a conversa. ${(e as Error).message}`);
    }
  };

  const classify = async () => {
    setClassifying(true);
    try {
      const updated = await api.classify(chat.jid);
      onChat(updated);
      notify("success", `Conversa classificada como ${updated.ai?.label ?? "—"}.`);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setClassifying(false);
    }
  };

  return (
    <section className="chat-pane" aria-label={`Conversa com ${chat.name}`}>
      <header className="chat-pane__header">
        <div className="chat-pane__title">
          <button className="icon-button chat-pane__back" aria-label="Voltar para a lista" onClick={onBack}>
            <ArrowLeft size={18} aria-hidden />
          </button>
          <span className="avatar" aria-hidden>
            {initials(chat.name)}
          </span>
          <div className="chat-pane__name">
            <h2 className="heading-card">{chat.name}</h2>
            {chat.phone && <span className="hint">+{chat.phone}</span>}
            {chat.isGroup && <span className="hint">Grupo</span>}
          </div>
        </div>
        <button
          className={`button button--secondary button--compact chat-pane__notes-toggle${chat.note || chat.reminderAt !== null ? " has-content" : ""}`}
          aria-pressed={notesOpen}
          onClick={() => setNotesOpen((v) => !v)}
        >
          <StickyNote size={16} aria-hidden /> Notas e lembretes
          {chat.reminderAt !== null && <AlarmClock size={14} aria-hidden />}
        </button>
        <ClassificationBar
          chat={chat}
          labels={labels}
          onChange={change}
          onClassify={classify}
          classifying={classifying}
          jevReady={jevReady}
          classifierName={classifierName}
        />
      </header>
      <div className="chat-pane__body">
      <div className="messages" ref={scroller} aria-live="polite" aria-busy={messages === null}>
        {messages === null ? (
          <div className="messages__loading">
            <LoaderCircle className="spin" size={24} aria-hidden />
            <span>Carregando mensagens…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty">
            <MessageSquareText size={36} aria-hidden />
            <p className="empty__title">Sem mensagens salvas</p>
            <p className="hint">As próximas mensagens desta conversa aparecem aqui.</p>
          </div>
        ) : (
          <Messages messages={messages} hasMore={hasMore} onMore={loadMore} loadingMore={loadingMore} />
        )}
      </div>
      {notesOpen && <NotesPanel chat={chat} onChat={onChat} notify={notify} onClose={() => setNotesOpen(false)} />}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="composer-text">
          Mensagem
        </label>
        {showQuick && <QuickReplyMenu items={quickItems} active={quickActive} onPick={pickQuick} onHover={setQuickActive} />}
        <button
          type="button"
          className="icon-button"
          aria-label="Respostas rápidas"
          title={quickReplies.length ? "Respostas rápidas (ou digite / no começo)" : "Cadastre respostas rápidas em Configurações"}
          disabled={!connected || !quickReplies.length}
          aria-expanded={showQuick}
          onClick={() => setQuickOpen((v) => !v)}
        >
          <Zap size={18} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={aiReady ? `Sugerir resposta com a ${aiName(ai)}` : "Ativar a IA"}
          title={aiReady ? `Sugerir resposta (${aiName(ai)}, revise antes de enviar)` : "Ativar a IA para sugerir respostas"}
          disabled={drafting || !connected}
          aria-busy={drafting || undefined}
          onClick={() => (aiReady ? void suggest() : onSetupAi())}
        >
          {drafting ? <LoaderCircle className="spin" size={18} aria-hidden /> : <WandSparkles size={18} aria-hidden />}
        </button>
        <textarea
          ref={composer}
          id="composer-text"
          rows={1}
          role="combobox"
          aria-expanded={showQuick}
          aria-controls={showQuick ? "quick-menu" : undefined}
          aria-activedescendant={showQuick ? `quick-${quickItems[quickActive]?.shortcut}` : undefined}
          aria-autocomplete="list"
          value={draft}
          disabled={!connected}
          placeholder={connected ? "Escreva uma mensagem. Enter envia, Shift+Enter quebra linha." : "Conecte o WhatsApp para responder."}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (showQuick) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setQuickActive((i) => (i + step + quickItems.length) % quickItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickQuick(quickItems[quickActive]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setQuickOpen(false);
                if (query !== null) setDraft("");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="button button--primary" type="submit" disabled={!connected || !draft.trim() || sending} aria-busy={sending || undefined}>
          {sending ? <LoaderCircle className="spin" size={18} aria-hidden /> : <SendHorizontal size={18} aria-hidden />}
          <span className="composer__label">Enviar</span>
        </button>
      </form>
    </section>
  );
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [chats, setChats] = useState<Map<string, Chat>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsUsed = useRef(false);
  if (settingsOpen) settingsUsed.current = true;
  const [settingsTab, setSettingsTab] = useState<"geral" | "ia" | undefined>(undefined);
  const [skipConnect, setSkipConnect] = useState(false);
  const { toasts, push, dismiss } = useToasts();
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const loadQuickReplies = useCallback(() => {
    api.quickReplies().then(setQuickReplies).catch(() => undefined);
  }, []);
  useEffect(loadQuickReplies, [loadQuickReplies]);

  // Rajadas de eventos (várias mensagens chegando juntas) viram uma única atualização da lista.
  const queued = useRef(new Map<string, Chat>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upsert = useCallback((chat: Chat | null) => {
    if (!chat) return;
    queued.current.set(chat.jid, chat);
    flushTimer.current ??= setTimeout(() => {
      flushTimer.current = null;
      const batch = queued.current;
      queued.current = new Map();
      setChats((prev) => {
        const next = new Map(prev);
        for (const [jid, c] of batch) next.set(jid, c);
        return next;
      });
    }, 30);
  }, []);

  const reload = useCallback(() => {
    api
      .chats()
      .then((list) => {
        queued.current.clear(); // a lista nova já traz o estado atual
        setChats(new Map(list.map((c) => [c.jid, c])));
        setLoaded(true);
      })
      .catch((e) => push("error", `Não foi possível carregar as conversas. ${e.message}`));
  }, [push]);

  useEffect(() => {
    reload();
    const es = new EventSource("/api/events");
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.addEventListener("state", (e) => setState(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("connection", (e) => {
      const connection = JSON.parse((e as MessageEvent).data) as Connection;
      setState((s) => (s ? { ...s, connection } : s));
    });
    es.addEventListener("chat", (e) => upsert(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("reload", () => {
      reload();
      api.state().then(setState).catch(() => undefined);
    });
    es.addEventListener("ai", (e) => window.dispatchEvent(new CustomEvent("inbox:ai", { detail: JSON.parse((e as MessageEvent).data) })));
    es.addEventListener("reminder", (e) => {
      const { chat } = JSON.parse((e as MessageEvent).data) as { chat: Chat };
      upsert(chat);
      push("success", `Lembrete: ${chat.name}. A conversa voltou para Abertas.`);
    });
    es.addEventListener("message", (e) => {
      const { message, chat } = JSON.parse((e as MessageEvent).data) as { message: Message; chat: Chat };
      upsert(chat);
      window.dispatchEvent(new CustomEvent("inbox:message", { detail: message }));
    });
    return () => es.close();
  }, [reload, upsert]);

  // Volta a carregar a lista quando o servidor volta (ex.: depois de reiniciar o app).
  const wasOnline = useRef(true);
  useEffect(() => {
    if (online && !wasOnline.current) {
      reload();
      api.ai().then(publishAi).catch(() => undefined);
    }
    wasOnline.current = online;
  }, [online, reload]);

  const sorted = useMemo(() => [...chats.values()].sort((a, b) => b.lastAt - a.lastAt), [chats]);
  const labels = useMemo(() => state?.labels.map((l) => l.name) ?? [], [state]);
  const current = selected ? (chats.get(selected) ?? null) : null;
  const connection: Connection = state?.connection ?? { status: "iniciando", qr: null, me: null, error: null };
  const showConnect = connection.status === "qr" && !skipConnect;

  useEffect(() => {
    if (connection.status === "conectado") setSkipConnect(false);
  }, [connection.status]);

  // Clique na notificação abre a conversa; "Configurações" na bandeja abre o painel.
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    const offChat = bridge.onOpenChat((jid) => {
      setSkipConnect(true);
      setSelected(jid);
    });
    const offSettings = bridge.onOpenSettings(() => setSettingsOpen(true));
    return () => {
      offChat();
      offSettings();
    };
  }, []);

  return (
    <div className="app" data-view={current ? "chat" : "list"}>
      {showConnect ? (
        <ConnectScreen connection={connection} onSkip={() => setSkipConnect(true)} />
      ) : (
        <>
          <ChatList
            chats={sorted}
            labels={labels}
            selected={selected}
            onOpen={setSelected}
            connection={connection}
            online={online}
            onSettings={() => setSettingsOpen(true)}
            loaded={loaded}
          />
          {current ? (
            <ChatView
              key={current.jid}
              chat={current}
              labels={labels}
              connected={online && connection.status === "conectado"}
              jevReady={!!state?.classifier.configured}
              classifierName={state?.classifier.provider === "deepseek" ? "DeepSeek" : "Jev"}
              onBack={() => setSelected(null)}
              notify={push}
              onChat={upsert}
              quickReplies={quickReplies}
              onSetupAi={() => {
                setSettingsTab("ia");
                setSettingsOpen(true);
              }}
            />
          ) : (
            <section className="chat-pane chat-pane--empty" aria-label="Nenhuma conversa aberta">
              <div className="empty">
                <MessageSquareText size={36} aria-hidden />
                <p className="empty__title">Escolha uma conversa</p>
                <p className="hint">Abra uma conversa da lista para ler, responder e classificar.</p>
              </div>
            </section>
          )}
        </>
      )}
      {state && settingsUsed.current && (
        <Suspense fallback={null}>
        <SettingsDrawer
          open={settingsOpen}
          initialTab={settingsTab}
          state={state}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
          onSaved={(s, text) => {
            setState(s);
            loadQuickReplies();
            push("success", text);
          }}
          notify={push}
        />
        </Suspense>
      )}
      <UpdateDialog />
      <Toasts toasts={toasts} dismiss={dismiss} />
      <div className="build-badge" aria-hidden="true">
        {formatBuild(__APP_VERSION__, __BUILD_DATE__)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
