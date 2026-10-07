import {
  AlarmClock,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  Forward,
  MoreVertical,
  Pencil,
  Reply,
  Trash2,
  CircleDot,
  Clock,
  Inbox,
  LoaderCircle,
  Mic,
  Paperclip,
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
  Clock3,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { priorityLevel, priorityScore } from "./priority.ts";
import { mediaUrl, api, type OutgoingMedia, type AppState, type Chat, type Connection, type Message, type Participant, type QuickReply, type Status } from "./api.ts";
import { Avatar, refreshAvatars } from "./avatar.tsx";
import { AiQuickPicker } from "./ai-quick.tsx";
import {
  applyMentions,
  canRevoke,
  DeleteDialog,
  filterParticipants,
  insertMention,
  MentionMenu,
  mentionLabel,
  mentionQuery,
  messageBody,
  quoteAuthor,
  ReplyBar,
  type MentionPick,
} from "./conversation.tsx";
import { ProfilePanel, type ProfileTarget } from "./profile.tsx";
import { applyTheme, storedTheme } from "./theme.ts";
import { NotesPanel, reminderLabel } from "./notes.tsx";
import { AttachmentTray, clock, fileToOutgoing, MAX_ATTACHMENT, MediaView, RecordingBar, toAttachment, useRecorder, type Attachment } from "./media.tsx";
import { aiName, isAiReady, publishAi, useAiStatus, useUsdBrl } from "./ai-state.ts";
import { fillQuickReply, quickQuery, QuickReplyMenu } from "./quick.tsx";
import { dayLabel, formatBrl, formatBuild, formatTime, formatTokens, initials, listTime, normalize, percent, sameDay } from "./format.ts";
// Configurações só carregam na primeira abertura: menos JS para interpretar ao iniciar.
const SettingsDrawer = lazy(() => import("./settings.tsx").then((m) => ({ default: m.SettingsDrawer })));
import { UpdateDialog } from "./update.tsx";
import { ForwardDialog } from "./forward.tsx";
import { MessageMenu, type MenuAt } from "./message-menu.tsx";
import { AckIcon, canEdit, EditBar, ReactButton, ReactionList } from "./message-extras.tsx";
import { WaInline, WaLive, WaText } from "./wa-format.tsx";
import { toggleWa } from "./wa-text.ts";
import { desktop } from "./desktop.ts";
import "./app.css";

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

// O index.html já pintou o tema salvo; aqui passa a acompanhar o Windows quando for "Sistema".
applyTheme(storedTheme());

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
        <Avatar jid={chat.jid} name={chat.name} />
        <span className="chat-item__body">
          <span className="chat-item__row">
            <span className="chat-item__name">{chat.name}</span>
            <span className={`chat-item__time${chat.unread ? " chat-item__time--unread" : ""}`}>{listTime(chat.lastAt)}</span>
          </span>
          <span className="chat-item__row">
            <span className="chat-item__preview">
              {chat.lastFromMe && <span className="chat-item__me">Você: </span>}
              {chat.lastText ? <WaInline text={chat.lastText} /> : "Sem mensagens"}
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

  const searchInput = useRef<HTMLInputElement>(null);
  const searching = query.trim() !== "";
  const clearSearch = () => {
    setQuery("");
    searchInput.current?.focus();
  };

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
        <label className={`search${searching ? " search--active" : ""}`}>
          <Search size={16} aria-hidden />
          <span className="sr-only">Buscar conversa</span>
          <input
            ref={searchInput}
            type="search"
            placeholder="Nome, número ou mensagem"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searching) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
          {searching && (
            <button type="button" className="search__clear" aria-label="Limpar busca" title="Limpar busca (Esc)" onClick={clearSearch}>
              <X size={14} aria-hidden />
            </button>
          )}
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
        {searching && props.loaded && (
          <div className="search-status" role="status">
            <Search size={14} aria-hidden />
            <p className="search-status__text">
              <strong>{filtered.length}</strong> {filtered.length === 1 ? "resultado" : "resultados"} para <q>{query.trim()}</q>
            </p>
            <button type="button" className="button button--ghost button--compact" onClick={clearSearch}>
              <X size={14} aria-hidden />
              Limpar busca
            </button>
          </div>
        )}
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
            <p className="empty__title">
              {!props.chats.length ? "Nenhuma conversa ainda" : searching ? `Nenhuma conversa para “${query.trim()}”` : "Nenhuma conversa nestes filtros"}
            </p>
            <p className="hint">
              {!props.chats.length
                ? "Conecte o WhatsApp. As conversas aparecem aqui conforme chegam."
                : searching
                  ? "Confira a grafia ou limpe a busca para ver todas as conversas."
                  : "Troque a aba de status ou a etiqueta."}
            </p>
            {searching && (
              <button type="button" className="button button--secondary" onClick={clearSearch}>
                <X size={16} aria-hidden />
                Limpar busca
              </button>
            )}
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

/** Em grupo, mensagem recebida chega como "Autor: texto". */
const splitAuthor = messageBody;

const AUTHOR_TONES = 6;
function authorTone(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % AUTHOR_TONES;
}

/** Junta o fim recarregado do servidor sem perder bolhas otimistas pendentes. */
function mergeTail(list: Message[], fresh: Message[]): Message[] {
  const known = new Set(list.map((x) => x.id));
  const added = fresh.filter((x) => !known.has(x.id));
  if (!added.length) return list;
  const pending = list.filter((x) => x.pending);
  return [...list.filter((x) => !x.pending), ...added].sort((a, b) => a.at - b.at).concat(pending);
}

/** Memo: digitar no campo de mensagem não redesenha o histórico inteiro. */
/** Texto exibido da mensagem (legenda, sem "[Imagem]" nem o nome do arquivo). */
function captionOf(m: Message, body: string): string {
  let caption = m.media ? body.replace(/^\[[^\]]+\]\s*/, "") : body;
  // Documento: o texto começa pelo nome do arquivo, que já aparece no cartão.
  const fileName = m.media?.fileName;
  if (fileName && caption.startsWith(fileName)) caption = caption.slice(fileName.length).trim();
  return caption;
}

const Messages = memo(function Messages({ messages, isGroup, hasMore, onMore, loadingMore, chatName, canAct, onReply, onDelete, onCopy, onAuthor, onJump, onReact, onForward, onEdit, onRetry, onDiscard, onMenu }: {
  messages: Message[];
  isGroup: boolean;
  hasMore: boolean;
  onMore: () => void;
  loadingMore: boolean;
  chatName: string;
  /** WhatsApp conectado: responder e apagar dependem dele. */
  canAct: boolean;
  onReply: (m: Message) => void;
  onDelete: (m: Message) => void;
  onCopy: (m: Message) => void;
  onAuthor: (jid: string, name: string) => void;
  onJump: (id: string) => void;
  onReact: (m: Message, emoji: string) => void;
  onForward: (m: Message) => void;
  onEdit: (m: Message) => void;
  onRetry: (m: Message) => void;
  onDiscard: (m: Message) => void;
  /** Botão direito ou "Mais opções": abre o menu da mensagem nesse ponto. */
  onMenu: (m: Message, x: number, y: number) => void;
}) {
  const parts = messages.map((m) => splitAuthor(m, isGroup));
  return (
    <>
      {hasMore && (
        <button className="button button--ghost button--compact messages__more" onClick={onMore} disabled={loadingMore} aria-busy={loadingMore || undefined}>
          {loadingMore && <LoaderCircle className="spin" size={16} aria-hidden />}
          Carregar mensagens anteriores
        </button>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = i === 0 || !sameDay(prev.at, m.at);
        const { author, body } = parts[i];
        // Sequência do mesmo remetente em até 5 min vira um bloco: nome e "rabicho" só na primeira.
        const continues = !newDay && prev.fromMe === m.fromMe && parts[i - 1].author === author && m.at - prev.at < 5 * 60_000;
        const caption = captionOf(m, body);
        const sender = m.sender;
        return (
          <div key={m.id} data-message-id={m.id} className={`message-row${m.fromMe ? " message-row--me" : ""}${continues ? " message-row--cont" : ""}${isGroup && !m.fromMe ? " message-row--group" : ""}`}>
            {newDay && <div className="day">{dayLabel(m.at)}</div>}
            <div
              className="message-line"
              onContextMenu={(e) => {
                // Texto selecionado: deixa o menu do sistema (copiar a seleção). Bolha ainda
                // não confirmada pelo servidor não tem ações (só tentar de novo ou descartar).
                if (m.pending || window.getSelection()?.toString().trim()) return;
                e.preventDefault();
                // Pelo teclado (tecla Menu / Shift+F10) não há ponto do mouse: usa o balão.
                const box = (e.currentTarget.querySelector(".bubble") ?? e.currentTarget).getBoundingClientRect();
                const keyboard = e.clientX === 0 && e.clientY === 0;
                onMenu(m, keyboard ? box.left + 8 : e.clientX, keyboard ? box.bottom : e.clientY);
              }}
            >
              {isGroup && !m.fromMe &&
                (sender && !continues ? (
                  <button type="button" className="author-button" aria-label={`Ver perfil de ${author ?? "participante"}`} onClick={() => onAuthor(sender, author ?? "Participante")}>
                    <Avatar jid={sender} name={author ?? "?"} className={`avatar--author tone-${authorTone(author ?? "?")}`} />
                  </button>
                ) : (
                  <span className={`avatar avatar--author tone-${authorTone(author ?? "?")}`} aria-hidden>
                    {continues ? "" : initials(author ?? "?")}
                  </span>
                ))}
              <div className="bubble-wrap">
              <div className={`bubble${m.fromMe ? " bubble--me" : ""}${m.kind !== "text" ? " bubble--media" : ""}${continues ? " bubble--cont" : ""}${m.media?.type === "sticker" ? " bubble--sticker" : ""}${m.deleted ? " bubble--deleted" : ""}${m.pending ? ` bubble--${m.pending}` : ""}`}>
                {author && !continues &&
                  (sender ? (
                    <button type="button" className={`bubble__author bubble__author--link tone-${authorTone(author)}`} onClick={() => onAuthor(sender, author)}>
                      {author}
                    </button>
                  ) : (
                    <span className={`bubble__author tone-${authorTone(author)}`}>{author}</span>
                  ))}
                {m.quoted && (
                  <button type="button" className="quote" onClick={() => onJump(m.quoted!.id)} title="Ir para a mensagem respondida">
                    <span className="quote__author">{quoteAuthor(m.quoted, chatName)}</span>
                    <span className="quote__text"><WaInline text={m.quoted.text} /></span>
                  </button>
                )}
                {m.deleted ? (
                  <p className="bubble__text bubble__text--deleted">
                    <Ban size={14} aria-hidden /> {m.fromMe ? "Você apagou esta mensagem" : "Esta mensagem foi apagada"}
                  </p>
                ) : (
                  <>
                    {m.media && <MediaView m={m} caption={caption} />}
                    {(!m.media || caption) && <p className="bubble__text"><WaText text={caption} /></p>}
                  </>
                )}
                {m.pending === "failed" ? (
                  <span className="bubble__time bubble__time--failed" role="alert">
                    Não enviada ·{" "}
                    <button type="button" className="bubble__retry" onClick={() => onRetry(m)} disabled={!canAct}>Tentar de novo</button>
                    {" · "}
                    <button type="button" className="bubble__retry" onClick={() => onDiscard(m)}>Descartar</button>
                  </span>
                ) : (
                  <span className="bubble__meta">
                    {m.editedAt !== null && !m.deleted && <span className="bubble__edited">Editada</span>}
                    <time className="bubble__time" dateTime={new Date(m.at).toISOString()} title={new Date(m.at).toLocaleString("pt-BR")}>
                      {formatTime(m.at)}
                    </time>
                    {m.pending === "sending" ? <Clock3 className="bubble__pending" size={11} aria-label="Enviando" /> : m.fromMe && !m.deleted && <AckIcon ack={m.ack} />}
                  </span>
                )}
              </div>
              {!m.pending && <ReactionList m={m} onReact={onReact} />}
              </div>
              {!m.pending && <div className="message-actions" role="group" aria-label="Ações da mensagem">
                {!m.deleted && (
                  <button type="button" className="icon-button icon-button--plain icon-button--small" aria-label="Responder" title="Responder" disabled={!canAct} onClick={() => onReply(m)}>
                    <Reply size={16} aria-hidden />
                  </button>
                )}
                {!m.deleted && <ReactButton m={m} onReact={onReact} disabled={!canAct} />}
                {!m.deleted && (!m.media || caption) && (
                  <button type="button" className="icon-button icon-button--plain icon-button--small" aria-label="Copiar texto" title="Copiar texto" onClick={() => onCopy(m)}>
                    <Copy size={16} aria-hidden />
                  </button>
                )}
                {!m.deleted && (
                  <button type="button" className="icon-button icon-button--plain icon-button--small" aria-label="Encaminhar" title="Encaminhar" disabled={!canAct} onClick={() => onForward(m)}>
                    <Forward size={16} aria-hidden />
                  </button>
                )}
                {canEdit(m) && (
                  <button type="button" className="icon-button icon-button--plain icon-button--small" aria-label="Editar mensagem" title="Editar" disabled={!canAct} onClick={() => onEdit(m)}>
                    <Pencil size={16} aria-hidden />
                  </button>
                )}
                <button type="button" className="icon-button icon-button--plain icon-button--small" aria-label="Apagar mensagem" title="Apagar" onClick={() => onDelete(m)}>
                  <Trash2 size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--plain icon-button--small"
                  aria-label="Mais opções"
                  aria-haspopup="menu"
                  title="Mais opções (ou clique com o botão direito)"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    onMenu(m, r.left, r.bottom + 4);
                  }}
                >
                  <MoreVertical size={16} aria-hidden />
                </button>
              </div>}
            </div>
          </div>
        );
      })}
    </>
  );
});

function ChatView({ chat, labels, connected, jevReady, classifierName, onBack, notify, onChat, quickReplies, onSetupAi, sendTyping }: {
  chat: Chat;
  /** Avisar ao contato que você está digitando (preferência). */
  sendTyping: boolean;
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
  // Um painel lateral por vez: notas e lembretes ou perfil.
  const [side, setSide] = useState<"notes" | "profile" | null>(null);
  const notesOpen = side === "notes";
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const openProfile = useCallback((target: ProfileTarget) => {
    setProfileTarget(target);
    setSide("profile");
  }, []);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [presence, setPresence] = useState<"composing" | "recording" | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  // Menções: participantes carregados no primeiro "@"; escolhas valem até enviar.
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [caret, setCaret] = useState(0);
  const [mentionActive, setMentionActive] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);
  const picks = useRef<MentionPick[]>([]);
  const [quickActive, setQuickActive] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const recorder = useRecorder((text) => notify("error", text));
  const addFiles = (files: Iterable<File>) => {
    const ok: Attachment[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT) notify("error", `${file.name} passa de 32 MB e não pode ser enviado por aqui.`);
      else if (file.size > 0) ok.push(toAttachment(file));
    }
    if (ok.length) setAttachments((list) => [...list, ...ok].slice(0, 10));
    requestAnimationFrame(() => composer.current?.focus());
  };
  const removeAttachment = (id: number) =>
    setAttachments((list) => {
      const gone = list.find((a) => a.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((a) => a.id !== id);
    });
  useEffect(() => {
    setAttachments((list) => {
      list.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
      return [];
    });
    recorder.cancel();
    setReplyTo(null);
    setEditing(null);
    setForwarding(null);
    setPresence(null);
    setParticipants(null);
    picks.current = [];
  }, [chat.jid]);
  useEffect(() => {
    const id = requestAnimationFrame(() => composer.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [chat.jid]);
  const ai = useAiStatus();
  const aiReady = isAiReady(ai);
  const usdBrl = useUsdBrl();
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
      setMessages((list) => {
        if (!list || list.some((x) => x.id === m.id)) return list;
        const i = m.fromMe ? list.findIndex((x) => x.pending === "sending" && x.text === m.text) : -1;
        return i >= 0 ? list.map((x, j) => (j === i ? m : x)) : [...list, m];
      });
    };
    // Apagada, editada, reação ou status de entrega: troca no lugar.
    const onUpdate = (e: Event) => {
      const m = (e as CustomEvent<Message>).detail;
      if (m.chatJid !== chat.jid) return;
      setMessages((list) => list && list.map((x) => (x.id === m.id ? m : x)));
      if (m.deleted) {
        setReplyTo((r) => (r?.id === m.id ? null : r));
        setEditing((r) => (r?.id === m.id ? null : r));
      }
    };
    // Apagada para mim: sai da lista.
    const onRemove = (e: Event) => {
      const { chatJid, id } = (e as CustomEvent<{ chatJid: string; id: string }>).detail;
      if (chatJid !== chat.jid) return;
      setMessages((list) => list && list.filter((x) => x.id !== id));
      setReplyTo((r) => (r?.id === id ? null : r));
    };
    window.addEventListener("inbox:message", onMessage);
    window.addEventListener("inbox:update", onUpdate);
    window.addEventListener("inbox:remove", onRemove);
    return () => {
      window.removeEventListener("inbox:message", onMessage);
      window.removeEventListener("inbox:update", onUpdate);
      window.removeEventListener("inbox:remove", onRemove);
    };
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
    if (chat.unread <= 0) return;
    onChat({ ...chat, unread: 0 });
    api.read(chat.jid).then(onChat).catch(() => undefined);
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

  type Outgoing = { text: string; quotedId?: string; mentions: string[]; mentionAll?: boolean };
  const pendingSeq = useRef(0);
  // Payload de cada bolha otimista, para "Tentar de novo".
  const outbox = useRef(new Map<string, Outgoing>());
  const deliver = useCallback(
    async (localId: string) => {
      const out = outbox.current.get(localId);
      if (!out) return;
      setMessages((list) => list && list.map((x) => (x.id === localId ? { ...x, pending: "sending" } : x)));
      try {
        const updated = await api.send(chat.jid, out.text, { quotedId: out.quotedId, mentions: out.mentions.length ? out.mentions : undefined, mentionAll: out.mentionAll });
        outbox.current.delete(localId);
        onChat(updated);
        // A versão real chega pelo SSE e já substitui a bolha; se não chegou, recarrega o fim da conversa.
        setMessages((list) => list && list.filter((x) => x.id !== localId));
        api.messages(chat.jid).then(
          (fresh) => setMessages((list) => (list ? mergeTail(list, fresh) : list)),
          () => undefined,
        );
      } catch (e) {
        setMessages((list) => list && list.map((x) => (x.id === localId ? { ...x, pending: "failed" } : x)));
        notify("error", `Mensagem não enviada. ${(e as Error).message}`);
      }
    },
    [chat.jid, notify, onChat],
  );
  const retry = useCallback((m: Message) => void deliver(m.id), [deliver]);
  const discard = useCallback((m: Message) => {
    outbox.current.delete(m.id);
    setMessages((list) => list && list.filter((x) => x.id !== m.id));
  }, []);

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || sending) return;
    stopTyping();
    if (editing) {
      // Otimista: o texto novo aparece na hora; volta ao original se o servidor recusar.
      const original = editing;
      setEditing(null);
      setDraft("");
      if (text === original.text) return;
      replaceMessage({ ...original, text, editedAt: Date.now() });
      try {
        replaceMessage(await api.editMessage(chat.jid, original.id, text));
      } catch (e) {
        replaceMessage(original);
        notify("error", `Mensagem não editada. ${(e as Error).message}`);
      }
      return;
    }
    stickToBottom.current = true;
    const quotedId = replyTo?.id;
    if (!attachments.length) {
      // Otimista: a bolha aparece na hora e o campo libera; o servidor confirma depois.
      const withMentions = applyMentions(text, picks.current);
      const localId = `local-${++pendingSeq.current}`;
      const quoted = replyTo
        ? { id: replyTo.id, text: splitAuthor(replyTo, chat.isGroup).body, fromMe: replyTo.fromMe, author: replyTo.fromMe ? null : splitAuthor(replyTo, chat.isGroup).author }
        : null;
      // "@todos" (ou "@all") digitado à mão também menciona o grupo inteiro.
      const mentionAll = chat.isGroup && (withMentions.mentionAll || /(^|\s)@(todos|all)(?=$|[\s.,;:!?])/i.test(text));
      outbox.current.set(localId, { text: withMentions.text, quotedId, mentions: withMentions.mentions, mentionAll: mentionAll || undefined });
      setMessages((list) => [
        ...(list ?? []),
        { chatJid: chat.jid, id: localId, fromMe: true, at: Date.now(), text: withMentions.text, kind: "text", media: null, quoted, deleted: false, sender: null, ack: null, editedAt: null, reactions: [], pending: "sending" },
      ]);
      setDraft("");
      setReplyTo(null);
      picks.current = [];
      void deliver(localId);
      return;
    }
    setSending(true);
    try {
      // A legenda vai no primeiro anexo; os outros seguem sem texto, como no WhatsApp.
      // A resposta (citação) vai só no primeiro.
      for (const [i, a] of attachments.entries()) {
        const file = a.voice ?? (await fileToOutgoing(a.file, i === 0 && text ? text : undefined));
        onChat(await api.sendMedia(chat.jid, i === 0 && quotedId ? { ...file, quotedId } : file));
        removeAttachment(a.id);
      }
      setDraft("");
      setReplyTo(null);
      picks.current = [];
    } catch (e) {
      notify("error", `Mensagem não enviada. ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const sendVoice = async () => {
    setSending(true);
    stickToBottom.current = true;
    let voice: OutgoingMedia | null = null;
    try {
      voice = await recorder.finish();
      if (!voice) return notify("error", "Gravação curta demais; segure por pelo menos meio segundo.");
      onChat(await api.sendMedia(chat.jid, replyTo ? { ...voice, quotedId: replyTo.id } : voice));
      setReplyTo(null);
    } catch (e) {
      // Não perde a gravação: volta para a bandeja de anexos, pronta para reenviar.
      if (voice) {
        const ready = voice;
        const bytes = Uint8Array.from(atob(voice.data), (c) => c.charCodeAt(0));
        const name = `Mensagem de voz (${clock(voice.seconds ?? 0)}).ogg`;
        setAttachments((list) => [...list, { ...toAttachment(new File([bytes], name, { type: "audio/ogg" })), voice: ready }]);
      }
      notify("error", `Áudio não enviado${voice ? "; ele ficou nos anexos para reenviar" : ""}. ${(e as Error).message}`);
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

  // "@" abre a lista de quem mencionar: participantes do grupo ou o próprio contato.
  const mention = showQuick ? null : mentionQuery(draft, caret);
  useEffect(() => {
    if (mention === null || participants !== null) return;
    if (!chat.isGroup) {
      setParticipants([{ jid: chat.jid, name: chat.name, phone: chat.phone, admin: false, me: false }]);
      return;
    }
    if (!connected) return;
    let alive = true;
    api
      .participants(chat.jid)
      .then((list) => alive && setParticipants(list))
      .catch((e: Error) => {
        if (!alive) return;
        setParticipants([]);
        notify("error", `Não foi possível carregar os participantes. ${e.message}`);
      });
    return () => {
      alive = false;
    };
  }, [mention !== null, participants, chat, connected, notify]);
  const mentionItems = mention !== null && participants && !mentionClosed ? filterParticipants(participants, mention, chat.isGroup) : [];
  const showMention = mentionItems.length > 0;
  useEffect(() => {
    setMentionActive(0);
    setMentionClosed(false);
  }, [mention]);
  const pickMention = (p: Participant) => {
    const label = mentionLabel(p);
    const next = insertMention(draft, caret, label);
    if (!picks.current.some((x) => x.jid === p.jid)) picks.current.push({ label, jid: p.jid });
    setDraft(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  // ---- ações da mensagem (callbacks estáveis para o memo de <Messages>)

  const reply = useCallback((m: Message) => {
    setReplyTo(m);
    requestAnimationFrame(() => composer.current?.focus());
  }, []);
  const copy = useCallback(
    (m: Message) => {
      // Mídia: copia só a legenda, sem o "[Imagem]" do começo.
      const text = captionOf(m, splitAuthor(m, chat.isGroup).body);
      navigator.clipboard.writeText(text).then(
        () => notify("success", "Texto copiado."),
        () => notify("error", "Não foi possível copiar."),
      );
    },
    [chat.isGroup, notify],
  );
  const askDelete = useCallback((m: Message) => setDeleting(m), []);
  const replaceMessage = (updated: Message) => setMessages((list) => list && list.map((x) => (x.id === updated.id ? updated : x)));
  const react = useCallback(
    async (m: Message, emoji: string) => {
      const reactions = [...m.reactions.filter((r) => !r.fromMe), ...(emoji ? [{ emoji, fromMe: true }] : [])];
      setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
      try {
        const updated = await api.react(chat.jid, m.id, emoji);
        setMessages((list) => list && list.map((x) => (x.id === updated.id ? updated : x)));
      } catch (e) {
        setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, reactions: m.reactions } : x)));
        notify("error", `Reação não enviada. ${(e as Error).message}`);
      }
    },
    [chat.jid, notify],
  );
  const forward = useCallback((m: Message) => setForwarding(m), []);
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  const openMenu = useCallback((message: Message, x: number, y: number) => setMenuAt({ message, x, y }), []);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const edit = useCallback((m: Message) => {
    setReplyTo(null);
    setEditing(m);
    setDraft(m.text);
    requestAnimationFrame(() => composer.current?.focus());
  }, []);
  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  // "digitando" do contato: assina ao abrir a conversa e limpa sozinho se o aviso de parada não vier.
  useEffect(() => {
    if (connected) api.watch(chat.jid).catch(() => undefined);
  }, [chat.jid, connected]);
  useEffect(() => {
    let timer = 0;
    const onPresence = (e: Event) => {
      const p = (e as CustomEvent<{ jid: string; state: "composing" | "recording" | null }>).detail;
      if (p.jid !== chat.jid) return;
      setPresence(p.state);
      window.clearTimeout(timer);
      if (p.state) timer = window.setTimeout(() => setPresence(null), 25_000);
    };
    window.addEventListener("inbox:presence", onPresence);
    return () => {
      window.removeEventListener("inbox:presence", onPresence);
      window.clearTimeout(timer);
    };
  }, [chat.jid]);

  // Meu "digitando": no máximo um aviso a cada 8 s; para depois de 4 s sem digitar.
  const typingAt = useRef(0);
  const typingStop = useRef(0);
  const stopTyping = useCallback(() => {
    window.clearTimeout(typingStop.current);
    if (!typingAt.current) return;
    typingAt.current = 0;
    api.typing(chat.jid, "paused").catch(() => undefined);
  }, [chat.jid]);
  const noteTyping = () => {
    if (!sendTyping || !connected) return;
    if (Date.now() - typingAt.current > 8000) {
      typingAt.current = Date.now();
      api.typing(chat.jid, "composing").catch(() => undefined);
    }
    window.clearTimeout(typingStop.current);
    typingStop.current = window.setTimeout(stopTyping, 4000);
  };
  useEffect(() => stopTyping, [stopTyping]);
  const showAuthor = useCallback(
    (jid: string, name: string) => openProfile({ jid, name, phone: jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] : null, isGroup: false }),
    [openProfile],
  );
  const jump = useCallback(
    (id: string) => {
      const row = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
      if (!row) return notify("error", "A mensagem respondida é mais antiga. Use Carregar mensagens anteriores.");
      row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      row.classList.remove("message-row--flash");
      void row.offsetWidth;
      row.classList.add("message-row--flash");
    },
    [notify],
  );
  const confirmDelete = async (mode: "everyone" | "me") => {
    if (!deleting) return;
    const target = deleting;
    const index = messages?.findIndex((x) => x.id === target.id) ?? -1;
    setDeleting(null);
    if (replyTo?.id === target.id) setReplyTo(null);
    if (mode === "me") setMessages((list) => list && list.filter((x) => x.id !== target.id));
    else replaceMessage({ ...target, deleted: true });
    try {
      const { chat: updated, synced } = await api.deleteMessage(chat.jid, target.id, mode);
      onChat(updated);
      if (!synced) notify("error", "Mensagem apagada neste computador. O celular não confirmou; apague lá também se precisar.");
    } catch (e) {
      setMessages((list) => {
        if (!list) return list;
        if (mode === "everyone") return list.map((x) => (x.id === target.id ? target : x));
        if (list.some((x) => x.id === target.id)) return list;
        const at = index < 0 ? list.length : Math.min(index, list.length);
        return [...list.slice(0, at), target, ...list.slice(at)];
      });
      notify("error", `Mensagem não apagada. ${(e as Error).message}`);
    }
  };

  const change = async (patch: { status?: Status; label?: string | null }) => {
    const before = chat;
    onChat({ ...chat, ...patch, ...("label" in patch ? { labelSource: patch.label ? "manual" : null } : {}) });
    try {
      onChat(await api.update(chat.jid, patch));
    } catch (e) {
      onChat(before);
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
    <section
      className={`chat-pane${dragging ? " chat-pane--drop" : ""}`}
      aria-label={`Conversa com ${chat.name}`}
      onDragOver={(e) => {
        if (!connected || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="drop-hint" aria-hidden>
          <Paperclip size={24} />
          <span>Solte para anexar</span>
        </div>
      )}
      <header className="chat-pane__header">
        <div className="chat-pane__title">
          <button className="icon-button chat-pane__back" aria-label="Voltar para a lista" onClick={onBack}>
            <ArrowLeft size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="chat-pane__who"
            aria-pressed={side === "profile" && profileTarget?.jid === chat.jid}
            title={chat.isGroup ? "Ver dados do grupo" : "Ver perfil do contato"}
            onClick={() =>
              side === "profile" && profileTarget?.jid === chat.jid
                ? setSide(null)
                : openProfile({ jid: chat.jid, name: chat.name, phone: chat.phone, isGroup: chat.isGroup })
            }
          >
            <Avatar jid={chat.jid} name={chat.name} />
            <span className="chat-pane__name">
              <span className="heading-card" role="heading" aria-level={2}>
                {chat.name}
              </span>
              {presence ? (
                <span className="hint chat-pane__presence" role="status">
                  {presence === "recording" ? "gravando áudio…" : chat.isGroup ? "alguém está digitando…" : "digitando…"}
                </span>
              ) : (
                <>
                  {chat.phone && <span className="hint">+{chat.phone}</span>}
                  {chat.isGroup && <span className="hint">Grupo · ver participantes</span>}
                </>
              )}
            </span>
          </button>
        </div>
        <div className="cluster chat-pane__tools">
          <button
            className={`button button--secondary button--compact chat-pane__notes-toggle${chat.note || chat.reminderAt !== null ? " has-content" : ""}`}
            aria-pressed={notesOpen}
            onClick={() => setSide((v) => (v === "notes" ? null : "notes"))}
          >
            <StickyNote size={16} aria-hidden /> Notas e lembretes
            {chat.reminderAt !== null && <AlarmClock size={14} aria-hidden />}
          </button>
          <AiQuickPicker onMore={onSetupAi} />
        </div>
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
          <Messages
            messages={messages}
            isGroup={chat.isGroup}
            hasMore={hasMore}
            onMore={loadMore}
            loadingMore={loadingMore}
            chatName={chat.name}
            canAct={connected}
            onReply={reply}
            onDelete={askDelete}
            onCopy={copy}
            onAuthor={showAuthor}
            onJump={jump}
            onReact={react}
            onForward={forward}
            onEdit={edit}
            onRetry={retry}
            onDiscard={discard}
            onMenu={openMenu}
          />
        )}
      </div>
      {notesOpen && <NotesPanel chat={chat} onChat={onChat} notify={notify} onClose={() => setSide(null)} />}
      {side === "profile" && profileTarget && <ProfilePanel target={profileTarget} connected={connected} onClose={() => setSide(null)} />}
      </div>
      {menuAt && (
        <MessageMenu
          at={menuAt}
          canAct={connected}
          hasText={!menuAt.message.deleted && !!captionOf(menuAt.message, splitAuthor(menuAt.message, chat.isGroup).body)}
          author={
            chat.isGroup && !menuAt.message.fromMe && menuAt.message.sender
              ? { jid: menuAt.message.sender, name: splitAuthor(menuAt.message, true).author ?? "participante" }
              : null
          }
          actions={{ onReply: reply, onReact: react, onCopy: copy, onForward: forward, onEdit: edit, onDelete: askDelete, onAuthor: showAuthor }}
          onClose={closeMenu}
        />
      )}
      {forwarding && (
        <ForwardDialog
          message={forwarding}
          onClose={() => setForwarding(null)}
          onDone={(to) => {
            setForwarding(null);
            notify("success", `Mensagem encaminhada para ${to.name}.`);
          }}
        />
      )}
      {deleting && <DeleteDialog message={deleting} busy={false} onCancel={() => setDeleting(null)} onConfirm={(mode) => void confirmDelete(mode)} />}
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
        {showMention && <MentionMenu items={mentionItems} active={mentionActive} onPick={pickMention} onHover={setMentionActive} />}
        {editing && <EditBar message={editing} onCancel={cancelEdit} />}
        {replyTo && <ReplyBar message={replyTo} isGroup={chat.isGroup} chatName={chat.name} onCancel={() => setReplyTo(null)} />}
        {attachments.length > 0 && <AttachmentTray items={attachments} onRemove={removeAttachment} disabled={sending} />}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {recorder.recording ? (
          <RecordingBar recorder={recorder} />
        ) : (
          <>
        <button
          type="button"
          className="icon-button"
          aria-label="Anexar arquivo"
          title="Anexar imagem, vídeo ou documento (ou arraste para a conversa, ou cole com Ctrl+V)"
          disabled={!connected || sending}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip size={18} aria-hidden />
        </button>
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
        <div className="composer__field">
        <div className="composer__mirror" ref={mirror} aria-hidden>
          <WaLive text={draft} />
        </div>
        <textarea
          ref={composer}
          id="composer-text"
          rows={1}
          role="combobox"
          aria-expanded={showQuick || showMention}
          aria-controls={showQuick ? "quick-menu" : showMention ? "mention-menu" : undefined}
          aria-activedescendant={showQuick ? `quick-${quickItems[quickActive]?.shortcut}` : showMention ? `mention-${mentionActive}` : undefined}
          aria-autocomplete="list"
          value={draft}
          disabled={!connected}
          placeholder={
            !connected
              ? "Conecte o WhatsApp para responder."
              : attachments.length
                ? "Legenda (opcional). Enter envia."
                : chat.isGroup
                  ? "Escreva uma mensagem. @ menciona, / respostas rápidas."
                  : "Escreva uma mensagem. Enter envia, Shift+Enter quebra linha."
          }
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            noteTyping();
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (!files.length) return;
            e.preventDefault();
            addFiles(files);
          }}
          onKeyDown={(e) => {
            const marker = formatShortcut(e);
            if (marker) {
              e.preventDefault();
              const el = e.currentTarget;
              const next = toggleWa(draft, el.selectionStart, el.selectionEnd, marker);
              setDraft(next.text);
              requestAnimationFrame(() => el.setSelectionRange(next.start, next.end));
              return;
            }
            if (showMention) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setMentionActive((i) => (i + step + mentionItems.length) % mentionItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(mentionItems[mentionActive] ?? mentionItems[0]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionClosed(true);
                return;
              }
            }
            if (e.key === "Escape" && (replyTo || editing) && !showQuick) {
              e.preventDefault();
              if (editing) cancelEdit();
              setReplyTo(null);
              return;
            }
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
        </div>
          </>
        )}
        {recorder.recording || draft.trim() || attachments.length || sending ? (
          <button
            className="button button--primary"
            type={recorder.recording ? "button" : "submit"}
            onClick={recorder.recording ? () => void sendVoice() : undefined}
            disabled={!connected || sending}
            aria-busy={sending || undefined}
          >
            {sending ? <LoaderCircle className="spin" size={18} aria-hidden /> : <SendHorizontal size={18} aria-hidden />}
            <span className="composer__label">Enviar</span>
          </button>
        ) : (
          <button type="button" className="button button--primary composer__mic" disabled={!connected} aria-label="Gravar mensagem de voz" title="Gravar mensagem de voz" onClick={() => void recorder.start()}>
            <Mic size={18} aria-hidden />
          </button>
        )}
      </form>
      {chat.aiUsage.calls > 0 && (
        <p className="ai-usage-line" title="Tokens e custo estimado de toda a IA usada nesta conversa (classificação, rascunho e resumo)">
          IA nesta conversa: {formatTokens(chat.aiUsage.tokens)} · ≈ {formatBrl(chat.aiUsage.costUsd * usdBrl)}
        </p>
      )}
    </section>
  );
}

/** Atalhos do WhatsApp Desktop: Ctrl+B negrito, Ctrl+I itálico, Ctrl+Shift+X tachado, Ctrl+Shift+M monoespaçado. */
function formatShortcut(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; key: string }): string | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (!e.shiftKey) return k === "b" ? "*" : k === "i" ? "_" : null;
  return k === "x" ? "~" : k === "m" ? "```" : null;
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
    es.addEventListener("presence", (e) => window.dispatchEvent(new CustomEvent("inbox:presence", { detail: JSON.parse((e as MessageEvent).data) })));
    es.addEventListener("update", (e) => {
      const { message, chat } = JSON.parse((e as MessageEvent).data) as { message: Message; chat: Chat | null };
      upsert(chat);
      window.dispatchEvent(new CustomEvent("inbox:update", { detail: message }));
    });
    es.addEventListener("remove", (e) => {
      const { chatJid, id, chat } = JSON.parse((e as MessageEvent).data) as { chatJid: string; id: string; chat: Chat | null };
      upsert(chat);
      window.dispatchEvent(new CustomEvent("inbox:remove", { detail: { chatJid, id } }));
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
    if (connection.status !== "conectado") return;
    setSkipConnect(false);
    // Fotos que falharam offline são buscadas de novo.
    refreshAvatars();
  }, [connection.status]);

  const theme = state?.prefs.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

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
              sendTyping={!!state?.prefs.sendTyping}
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
