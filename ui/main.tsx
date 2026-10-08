import {
  AlarmClock,
  Archive,
  ArrowLeft,
  BellOff,
  Pin,
  Ban,
  CheckCircle2,
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
  Contact,
  MessageSquareText,
  Search,
  SendHorizontal,
  Settings,
  UserPlus,
  Smartphone,
  Sparkles,
  WandSparkles,
  StickyNote,
  Zap,
  TriangleAlert,
  WifiOff,
  X,
  Clock3,
  ChevronUp,
  ChevronDown,
  ListChecks,
  MapPin,
  MessageSquarePlus,
  Plus,
  Star,
  Sticker,
  Timer,
  UserRoundPlus,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { priorityLevel, priorityScore } from "./priority.ts";
import { mediaUrl, api, type OutgoingMedia, type AppState, type Chat, type ChatPatch, type Connection, type Message, type Participant, type QuickReply, type SearchHit, type Status } from "./api.ts";
import { ChatItemMenu, drafts, ExtraLabelsPicker, isMuted, isSnoozed, MessageHits, ShortcutsDialog, untilLabel } from "./organize.tsx";
import { Avatar, refreshAvatars } from "./avatar.tsx";
import { AiQuickPicker } from "./ai-quick.tsx";
import { Button, Menu, SearchBox, Select } from "./ds/index.ts";
import { LocationDialog, NewChatDialog, PollDialog, StarredDialog, StickerDialog } from "./dialogs.tsx";
import { isRich, PinnedBar, RichContent, type RichActions } from "./rich.tsx";
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
import { ResizeHandle } from "./resize.tsx";
import { AttachmentTray, clock, copyMedia, fileToOutgoing, MAX_ATTACHMENT, MediaView, RecordingBar, toAttachment, useRecorder, viewMedia, type Attachment } from "./media.tsx";
import { aiName, isAiReady, publishAi, useAiStatus, useUsdBrl } from "./ai-state.ts";
import { fillQuickReply, quickQuery, QuickReplyMenu } from "./quick.tsx";
import { convertEmoticon, EmojiButton, EmojiShortcutMenu, emojiQuery, insertAt, insertEmojiShortcut, rememberEmoji, searchEmoji, undoEmoticon, useEmojiData, type EmoticonSwap } from "./emoji.tsx";
import type { Emoji } from "./emoji-data.ts";
import { dayLabel, formatBrl, formatBuild, formatTime, formatTokens, initials, listTime, normalize, percent, sameDay } from "./format.ts";
// Configurações só carregam na primeira abertura: menos JS para interpretar ao iniciar.
const SettingsDrawer = lazy(() => import("./settings.tsx").then((m) => ({ default: m.SettingsDrawer })));
import { UpdateDialog } from "./update.tsx";
import { ForwardDialog } from "./forward.tsx";
import { MessageMenu, type MenuAt } from "./message-menu.tsx";
import { AckIcon, canEdit, CopyButton, EditBar, ReactButton, ReactionList } from "./message-extras.tsx";
import { WaInline, WaLive, WaText } from "./wa-format.tsx";
import { firstLink, toggleWa } from "./wa-text.ts";
import { LinkCard } from "./link-preview.tsx";
import { ContactCards, ContactPicker } from "./contacts.tsx";
import { SelectionBar } from "./selection.tsx";
import { selectionText } from "./selection-text.ts";
import { desktop, useAccount } from "./desktop.ts";
import { BADGE_FONT, badgeImage } from "./badge.ts";
import "./ds/styles.css";
import "./app.css";

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

// O index.html já pintou o tema salvo; aqui passa a acompanhar o Windows quando for "Sistema".
applyTheme(storedTheme());

/** Resposta em particular: a mensagem do grupo vai citada na conversa individual `to`. */
type PrivateReply = { to: string; message: Message; from: { jid: string; name: string; isGroup: boolean } };

/** Prazo das temporárias em palavras (mesma regra do servidor). */
const ephemeralLabel = (s: number) => (s % 86400 === 0 ? (s === 86400 ? "24 horas" : `${s / 86400} dias`) : `${Math.round(s / 3600)} horas`);

type Tab = Status | "todas";
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "aberta", label: "Abertas", icon: <CircleDot size={16} aria-hidden /> },
  { id: "aguardando", label: "Aguardando", icon: <Clock size={16} aria-hidden /> },
  { id: "resolvida", label: "Resolvidas", icon: <CheckCircle2 size={16} aria-hidden /> },
  { id: "todas", label: "Todas", icon: <Inbox size={16} aria-hidden /> },
];
const STATUS_META: Record<Status, { label: string; icon: ReactNode }> = {
  aberta: { label: "Aberta", icon: <CircleDot size={16} aria-hidden /> },
  aguardando: { label: "Aguardando", icon: <Clock size={16} aria-hidden /> },
  resolvida: { label: "Resolvida", icon: <CheckCircle2 size={16} aria-hidden /> },
};
const PAGE = 200;

type Toast = { id: number; kind: "error" | "success"; text: string; action?: { label: string; run: () => void } };

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string, action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text, action }]);
    // Com "Desfazer", fica um pouco mais para dar tempo de clicar.
    if (kind === "success") setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 4000);
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
          {t.action && (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </Button>
          )}
          <Button variant="ghost" size="compact" aria-label="Fechar aviso" icon={<X size={16} aria-hidden />} onClick={() => dismiss(t.id)} />
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
        <Button variant="ghost" onClick={onSkip}>
          Ver conversas salvas
        </Button>
      </div>
    </div>
  );
}

/** Memo: chegada de mensagem numa conversa não redesenha as outras 200 da lista. */
const ChatItem = memo(function ChatItem({ chat, selected, onOpen, onMenu }: { chat: Chat; selected: boolean; onOpen: (jid: string) => void; onMenu: (jid: string, x: number, y: number) => void }) {
  const urgent = (chat.ai?.urgent ?? 0) >= 0.5;
  const reminderDue = chat.reminderAt !== null && chat.reminderAt <= Date.now();
  const level = priorityLevel(priorityScore(chat));
  // Prioridade dita pela IA aparece sempre; "baixa" só quando não há nada mais relevante.
  const aiPriority = chat.ai?.priority ?? null;
  const showPriority = !!aiPriority && chat.status !== "resolvida" && (aiPriority !== "baixa" || (!level && !urgent && chat.reminderAt === null));
  return (
    <li>
      <button
        className="chat-item"
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(chat.jid)}
        onContextMenu={(e) => {
          e.preventDefault();
          // Pelo teclado (tecla Menu / Shift+F10) não há ponto do mouse: abre sob o item.
          const box = e.currentTarget.getBoundingClientRect();
          const keyboard = e.clientX === 0 && e.clientY === 0;
          onMenu(chat.jid, keyboard ? box.left + 8 : e.clientX, keyboard ? box.bottom : e.clientY);
        }}
      >
        <Avatar jid={chat.jid} name={chat.name} />
        <span className="chat-item__body">
          <span className="chat-item__row">
            <span className="chat-item__name">{chat.name}</span>
            {isMuted(chat) && <BellOff className="chat-item__flag" size={14} aria-label="Silenciada" />}
            {chat.pinnedAt && <Pin className="chat-item__flag" size={14} aria-label="Fixada" />}
            <span className={`chat-item__time${chat.unread || chat.markedUnread ? " chat-item__time--unread" : ""}`}>{listTime(chat.lastAt)}</span>
          </span>
          <span className="chat-item__row">
            <span className="chat-item__preview">
              {chat.lastFromMe && <span className="chat-item__me">Você: </span>}
              {chat.lastText ? <WaInline text={chat.lastText} /> : "Sem mensagens"}
            </span>
            {chat.unread > 0 ? (
              <span className="count" aria-label={`${chat.unread} não lidas`}>
                {chat.unread > 99 ? "99+" : chat.unread}
              </span>
            ) : (
              chat.markedUnread && <span className="count count--dot" role="img" aria-label="Marcada como não lida" />
            )}
          </span>
          {(chat.label || chat.extraLabels.length > 0 || urgent || chat.reminderAt !== null || level || showPriority || isSnoozed(chat)) && (
            <span className="chat-item__tags">
              {showPriority && aiPriority && <span className={`badge ${PRIORITY_META[aiPriority].cls}`}>{PRIORITY_META[aiPriority].text}</span>}
              {level && !urgent && !showPriority && (
                <span className={`badge ${level === "alta" ? "badge--danger" : "badge--warning"}`}>
                  {level === "alta" ? "Responder já" : "Responder hoje"}
                </span>
              )}
              {chat.label && <span className="badge badge--info">{chat.label}</span>}
              {chat.extraLabels.map((l) => (
                <span key={l} className="badge badge--neutral">
                  {l}
                </span>
              ))}
              {isSnoozed(chat) && (
                <span className="badge badge--neutral">
                  <Clock size={12} aria-hidden /> Adiada até {untilLabel(chat.snoozedUntil!)}
                </span>
              )}
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
  byJid: Map<string, Chat>;
  labels: string[];
  selected: string | null;
  onOpen: (jid: string) => void;
  /** Abre a conversa já na mensagem achada pela busca. */
  onOpenAt: (jid: string, id: string) => void;
  /** Ordem que está na tela, para os atalhos de próxima/anterior. */
  onVisible: (jids: string[]) => void;
  connection: Connection;
  online: boolean;
  onSettings: () => void;
  loaded: boolean;
  /** Arquivar ou fixar pelo clique direito, sem abrir a conversa. */
  onPatch: (jid: string, patch: ChatPatch) => void;
  onNewChat: () => void;
  onStarred: () => void;
}) {
  const account = useAccount();
  const [tab, setTab] = useState<Tab>("aberta");
  const [menu, setMenu] = useState<{ jid: string; x: number; y: number } | null>(null);
  const openMenu = useCallback((jid: string, x: number, y: number) => setMenu({ jid, x, y }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuChat = menu ? props.byJid.get(menu.jid) : undefined;
  const [showArchived, setShowArchived] = useState(false);
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

  // Arquivadas ficam fora das abas; adiadas, fora de Abertas e Aguardando até a hora marcada.
  const counts = useMemo(() => {
    const now = Date.now();
    const c: Record<Tab, number> & { arquivadas: number } = { aberta: 0, aguardando: 0, resolvida: 0, todas: 0, arquivadas: 0 };
    for (const chat of props.chats) {
      if (chat.archived) {
        c.arquivadas++;
        continue;
      }
      c.todas++;
      if (chat.status === "resolvida" || !isSnoozed(chat, now)) c[chat.status]++;
    }
    return c;
  }, [props.chats]);

  const filtered = useMemo(() => {
    const q = normalize(deferredQuery.trim());
    const now = Date.now();
    const list = props.chats.filter(
      (c) =>
        (showArchived
          ? c.archived
          : !c.archived && (tab === "todas" || (c.status === tab && (tab === "resolvida" || !isSnoozed(c, now))))) &&
        (!label || (label === "__none" ? !c.label && !c.extraLabels.length : c.label === label || c.extraLabels.includes(label))) &&
        (!q || searchText(c).includes(q)),
    );
    const ordered =
      order === "prioridade"
        ? list
            .map((c) => ({ c, s: priorityScore(c, now) }))
            .sort((a, b) => b.s - a.s || b.c.lastAt - a.c.lastAt)
            .map((x) => x.c)
        : list;
    // Fixadas no topo, na ordem em que foram fixadas (a mais recente primeiro).
    const pinned = ordered.filter((c) => c.pinnedAt).sort((a, b) => b.pinnedAt! - a.pinnedAt!);
    return pinned.length ? [...pinned, ...ordered.filter((c) => !c.pinnedAt)] : ordered;
  }, [props.chats, tab, label, deferredQuery, order, showArchived]);

  const { onVisible } = props;
  useEffect(() => onVisible(filtered.map((c) => c.jid)), [filtered, onVisible]);

  // Busca também no texto das mensagens (servidor), a partir de 2 letras.
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  const messageQuery = deferredQuery.trim().length >= 2 ? deferredQuery.trim() : "";
  useEffect(() => {
    if (!messageQuery) {
      setHits([]);
      return;
    }
    let alive = true;
    setHitsLoading(true);
    const timer = setTimeout(() => {
      api
        .search(messageQuery)
        .then((list) => alive && setHits(list))
        .catch(() => alive && setHits([]))
        .finally(() => alive && setHitsLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [messageQuery]);

  useEffect(() => setLimit(PAGE), [tab, label, query, showArchived]);

  const searchInput = useRef<HTMLInputElement>(null);
  const searching = query.trim() !== "";
  const clearSearch = () => {
    setQuery("");
    searchInput.current?.focus();
  };

  return (
    <section className="list-pane" aria-label="Conversas">
      <ResizeHandle cssVar="--inbox-list-w" storageKey="inbox:list-w" initial={360} min={280} max={520} edge="end" reserve={360} label="Largura da lista de conversas" />
      <header className="list-pane__header">
        <div className="split">
          <div>
            {account && account.count > 1 && <p className="eyebrow">{account.name}</p>}
            <h1 className="heading-page">Conversas</h1>
          </div>
          <div className="cluster">
            <Button variant="ghost" aria-label="Nova conversa ou grupo" title="Nova conversa ou grupo" icon={<MessageSquarePlus size={18} aria-hidden />} disabled={props.connection.status !== "conectado"} onClick={props.onNewChat} />
            <Button variant="ghost" aria-label="Mensagens favoritas" title="Mensagens favoritas" icon={<Star size={18} aria-hidden />} onClick={props.onStarred} />
            {account && account.count < account.max && (
              <Button variant="ghost" aria-label="Adicionar conta do WhatsApp" title="Adicionar conta do WhatsApp" icon={<UserPlus size={18} aria-hidden />} onClick={() => void desktop()?.addAccount()} />
            )}
            <Button variant="ghost" aria-label="Abrir configurações" title="Configurações" icon={<Settings size={18} aria-hidden />} onClick={props.onSettings} />
          </div>
        </div>
        <ConnectionPill connection={props.connection} online={props.online} />
        <SearchBox
          ref={searchInput}
          id="chat-search"
          aria-label="Buscar conversa"
          placeholder="Nome, número ou mensagem (Ctrl+K)"
          value={query}
          onChange={setQuery}
        />
        <div className="segmented" role="tablist" aria-label="Status da conversa">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={!showArchived && tab === t.id}
              className="segmented__item"
              aria-label={`${t.label} (${counts[t.id]})`}
              title={t.label}
              onClick={() => {
                setTab(t.id);
                setShowArchived(false);
              }}
            >
              <span className="segmented__icon">{t.icon}</span>
              <span className="segmented__label">{t.label}</span> <span className="segmented__count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="list-pane__filters">
        <Select
          aria-label="Filtrar por etiqueta"
          size="compact"
          clearable={false}
          searchable={props.labels.length > 8}
          // O Select do DS trata "" como vazio (mostra "Selecione"); "__all" representa o filtro sem etiqueta escolhida.
          value={label || "__all"}
          onChange={(v) => setLabel(v && v !== "__all" ? v : "")}
          options={[
            { value: "__all", label: "Todas as etiquetas" },
            { value: "__none", label: "Sem etiqueta" },
            ...props.labels.map((l) => ({ value: l, label: l })),
          ]}
        />
        <Select
          aria-label="Ordenar conversas"
          size="compact"
          clearable={false}
          searchable={false}
          value={order}
          onChange={(v) => v && chooseOrder(v as "recentes" | "prioridade")}
          options={[
            { value: "recentes", label: "Mais recentes" },
            { value: "prioridade", label: "Responder primeiro" },
          ]}
        />
        </div>
        {searching && props.loaded && (
          <div className="search-status" role="status">
            <Search size={14} aria-hidden />
            <p className="search-status__text">
              <strong>{filtered.length}</strong> {filtered.length === 1 ? "resultado" : "resultados"} para <q>{query.trim()}</q>
            </p>
            <Button variant="ghost" size="compact" icon={<X size={14} aria-hidden />} onClick={clearSearch}>
              Limpar busca
            </Button>
          </div>
        )}
      </header>
      <div className="list-pane__scroll">
        {(showArchived || counts.arquivadas > 0) && (
          <button type="button" className="archived-toggle" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? <ArrowLeft size={16} aria-hidden /> : <Archive size={16} aria-hidden />}
            {showArchived ? "Voltar para as conversas" : "Arquivadas"}
            {!showArchived && <span className="segmented__count">{counts.arquivadas}</span>}
          </button>
        )}
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
              {!props.chats.length
                ? "Nenhuma conversa ainda"
                : searching
                  ? `Nenhuma conversa para “${query.trim()}”`
                  : showArchived
                    ? "Nenhuma conversa arquivada nestes filtros"
                    : "Nenhuma conversa nestes filtros"}
            </p>
            <p className="hint">
              {!props.chats.length
                ? "Conecte o WhatsApp. As conversas aparecem aqui conforme chegam."
                : searching
                  ? "Confira a grafia ou limpe a busca para ver todas as conversas."
                  : "Troque a aba de status ou a etiqueta."}
            </p>
            {searching && (
              <Button variant="secondary" icon={<X size={16} aria-hidden />} onClick={clearSearch}>
                Limpar busca
              </Button>
            )}
          </div>
        ) : (
          <ul className="chat-list">
            {filtered.slice(0, limit).map((c) => (
              <ChatItem key={c.jid} chat={c} selected={c.jid === props.selected} onOpen={props.onOpen} onMenu={openMenu} />
            ))}
          </ul>
        )}
        {filtered.length > limit && (
          <Button variant="ghost" fullWidth onClick={() => setLimit((l) => l + PAGE)}>
            Mostrar mais {Math.min(PAGE, filtered.length - limit)}
          </Button>
        )}
        {messageQuery && <MessageHits hits={hits} chats={props.byJid} loading={hitsLoading} onOpen={props.onOpenAt} />}
      </div>
      {menu && menuChat && <ChatItemMenu chat={menuChat} x={menu.x} y={menu.y} onChange={(patch) => props.onPatch(menuChat.jid, patch)} onClose={closeMenu} />}
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
  onChange: (patch: ChatPatch) => void;
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
            title={STATUS_META[s].label}
            onClick={() => chat.status !== s && onChange({ status: s })}
          >
            {STATUS_META[s].icon}
            <span>{STATUS_META[s].label}</span>
          </button>
        ))}
      </div>
      <span className="chat-pane__divider" aria-hidden />
      <Select
        aria-label="Etiqueta"
        size="compact"
        className="field--label"
        placeholder="Sem etiqueta"
        searchable={labels.length > 8}
        value={chat.label ?? null}
        onChange={(v) => onChange({ label: v || null })}
        options={labels.map((l) => ({ value: l, label: l }))}
      />
      <ExtraLabelsPicker chat={chat} labels={labels} onChange={onChange} />
      {(() => {
        // Classificar e o palpite da IA são um controle só: o botão mostra o resultado e refaz ao clicar.
        const ai = chat.ai;
        const detail = ai
          ? [
              `IA: ${ai.label} (${percent(ai.confidence)})`,
              ai.priority && PRIORITY_META[ai.priority].text.toLowerCase(),
              ai.needsReply >= 0.5 && "espera resposta",
              ai.urgent >= 0.5 && "urgente",
              chat.labelSource === "manual" && chat.label !== ai.label && "etiqueta escolhida por você",
              ai.reason,
            ].filter(Boolean).join(" · ")
          : "";
        const title = !jevReady
          ? "Configure a chave do Jev ou da DeepSeek em Configurações › IA"
          : ai
            ? `${detail}\nClique para classificar de novo com ${classifierName}.`
            : `Pedir ao ${classifierName} para classificar esta conversa`;
        return (
          <Button
            variant="secondary"
            size="compact"
            className="classify__ai-button"
            onClick={onClassify}
            disabled={classifying || !jevReady}
            aria-busy={classifying || undefined}
            title={title}
            aria-label={ai ? `Classificado pela IA: ${detail}. Classificar de novo com ${classifierName}` : `Classificar com ${classifierName}`}
            icon={classifying ? <LoaderCircle className="spin" size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
          >
            {ai && (
              <span className="classify__ai-text" aria-hidden>
                {ai.label} <span className="classify__ai-pct">{percent(ai.confidence)}</span>
              </span>
            )}
          </Button>
        );
      })()}
      {chat.aiError && (
        <p className="classify__ai classify__ai--error" title={chat.aiError}>
          <TriangleAlert size={14} aria-hidden />
          <span>{chat.aiError}</span>
        </p>
      )}
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

const Messages = memo(function Messages({ messages, isGroup, hasMore, onMore, loadingMore, chatName, canAct, targetId, hitId, onReply, onDelete, onCopy, onAuthor, onJump, onReact, onForward, onEdit, onRetry, onDiscard, onMenu, selected, onToggleSelect, onOpenContact, onCopyText, rich }: {
  /** Enquete, evento e convite: votar e entrar no grupo. */
  rich: RichActions;
  messages: Message[];
  isGroup: boolean;
  hasMore: boolean;
  onMore: () => void;
  loadingMore: boolean;
  chatName: string;
  /** WhatsApp conectado: responder e apagar dependem dele. */
  canAct: boolean;
  /** Mensagem sendo respondida ou editada: fica destacada na conversa. */
  targetId: string | null;
  /** Resultado atual da busca na conversa (Ctrl+F). */
  hitId: string | null;
  onReply: (m: Message) => void;
  onDelete: (m: Message) => void;
  onCopy: (m: Message, quiet?: boolean) => Promise<boolean>;
  onAuthor: (jid: string, name: string) => void;
  onJump: (id: string) => void;
  onReact: (m: Message, emoji: string) => void;
  onForward: (m: Message) => void;
  onEdit: (m: Message) => void;
  onRetry: (m: Message) => void;
  onDiscard: (m: Message) => void;
  /** Botão direito ou "Mais opções": abre o menu da mensagem nesse ponto. */
  onMenu: (m: Message, x: number, y: number) => void;
  /** Modo de seleção (várias mensagens): ids marcados; null = desligado. */
  selected: Set<string> | null;
  onToggleSelect: (m: Message) => void;
  /** "Conversar" no cartão de contato. */
  onOpenContact: (digits: string) => void;
  onCopyText: (text: string) => void;
}) {
  const parts = messages.map((m) => splitAuthor(m, isGroup));
  return (
    <>
      {hasMore && (
        <Button variant="ghost" size="compact" className="messages__more" onClick={onMore} loading={loadingMore}>
          Carregar mensagens anteriores
        </Button>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = i === 0 || !sameDay(prev.at, m.at);
        const { author, body } = parts[i];
        // Sequência do mesmo remetente em até 5 min vira um bloco: nome e "rabicho" só na primeira.
        const continues = !newDay && prev.fromMe === m.fromMe && parts[i - 1].author === author && m.at - prev.at < 5 * 60_000;
        const caption = captionOf(m, body);
        const sender = m.sender;
        // Aviso do grupo ou da conversa (entrou, saiu, temporárias, fixou): linha central, sem balão nem ações.
        if (m.kind === "system") {
          return (
            <div key={m.id} data-message-id={m.id} className="message-row message-row--system">
              {newDay && <div className="day">{dayLabel(m.at)}</div>}
              <p className="notice" title={new Date(m.at).toLocaleString("pt-BR")}>
                {m.text}
              </p>
            </div>
          );
        }
        const richView = isRich(m);
        const link = !m.deleted && !m.media && !m.contacts && !richView ? firstLink(caption) : null;
        const selectable = !!selected && !m.pending && !m.deleted;
        const isSelected = selectable && selected.has(m.id);
        return (
          <div key={m.id} data-message-id={m.id} className={`message-row${selected ? " message-row--selecting" : ""}${isSelected ? " message-row--selected" : ""}${m.fromMe ? " message-row--me" : ""}${continues ? " message-row--cont" : ""}${isGroup && !m.fromMe ? " message-row--group" : ""}${m.id === targetId ? " message-row--target" : ""}${m.id === hitId ? " message-row--hit" : ""}`}>
            {newDay && <div className="day">{dayLabel(m.at)}</div>}
            <div
              className="message-line"
              onClickCapture={(e) => {
                // Selecionando: clicar em qualquer ponto da mensagem marca/desmarca (links e mídia não abrem).
                if (!selected) return;
                e.preventDefault();
                e.stopPropagation();
                if (selectable) onToggleSelect(m);
              }}
              onContextMenu={(e) => {
                if (selected) return e.preventDefault();
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
              {selected && (
                <input
                  type="checkbox"
                  className="message-check"
                  aria-label={isSelected ? "Desmarcar mensagem" : "Selecionar mensagem"}
                  checked={isSelected}
                  disabled={!selectable}
                  onChange={() => {}}
                />
              )}
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
              <div className={`bubble${m.fromMe ? " bubble--me" : ""}${m.kind !== "text" && !richView ? " bubble--media" : ""}${richView ? " bubble--rich" : ""}${continues ? " bubble--cont" : ""}${m.media?.type === "sticker" ? " bubble--sticker" : ""}${m.deleted ? " bubble--deleted" : ""}${m.pending ? ` bubble--${m.pending}` : ""}`}>
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
                ) : richView ? (
                  <RichContent m={m} canAct={canAct} actions={rich} />
                ) : (
                  <>
                    {m.media && <MediaView m={m} caption={caption} />}
                    {link && <LinkCard url={link} />}
                    {m.contacts?.length ? (
                      <ContactCards contacts={m.contacts} onOpen={onOpenContact} onCopy={onCopyText} />
                    ) : (
                      (!m.media || caption) && <p className="bubble__text"><WaText text={caption} /></p>
                    )}
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
                    {m.starred && !m.deleted && <Star className="bubble__star" size={11} aria-label="Favorita" />}
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
              {!m.pending && !selected && <div className="message-actions" role="group" aria-label="Ações da mensagem">
                {!m.deleted && m.kind !== "call" && (
                  <button type="button" className="icon-button icon-button--plain icon-button--small" aria-label="Responder" title="Responder" disabled={!canAct} onClick={() => onReply(m)}>
                    <Reply size={16} aria-hidden />
                  </button>
                )}
                {!m.deleted && m.kind !== "call" && <ReactButton m={m} onReact={onReact} disabled={!canAct} />}
                {!m.deleted && !richView && (!m.media || caption) && <CopyButton m={m} onCopy={onCopy} />}
                {!m.deleted && m.kind !== "call" && (
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

function ChatView({ chat, labels, connected, jevReady, classifierName, onBack, notify, onChat, onOpen, quickReplies, onSetupAi, sendTyping, focus, privateReply, onPrivateReply }: {
  /** Resposta em particular vinda de um grupo: abre a conversa já citando a mensagem do grupo. */
  privateReply: PrivateReply | null;
  /** "Responder em particular" numa mensagem de grupo. */
  onPrivateReply: (m: Message) => void;
  chat: Chat;
  /** Abre outra conversa (ex.: "Conversar" de um cartão de contato). */
  onOpen: (chat: Chat) => void;
  /** Mensagem para abrir em destaque (vinda da busca); `seq` força reabrir a mesma. */
  focus: { id: string; seq: number } | null;
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
  // Citação de outra conversa (responder em particular a alguém do grupo).
  const [replyFrom, setReplyFrom] = useState<{ jid: string; name: string; isGroup: boolean } | null>(null);
  const [composeDialog, setComposeDialog] = useState<"poll" | "location" | "sticker" | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message[] | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [pickingContact, setPickingContact] = useState(false);
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
  const [emojiActive, setEmojiActive] = useState(0);
  const [emojiClosed, setEmojiClosed] = useState(false);
  // Última troca de emoticon (":-)" → 🙂): Backspace logo em seguida desfaz.
  const emoticonSwap = useRef<EmoticonSwap | null>(null);
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
    setReplyFrom(null);
    setComposeDialog(null);
    setEditing(null);
    setForwarding(null);
    setPresence(null);
    setParticipants(null);
    picks.current = [];
  }, [chat.jid]);
  // Veio de "Responder em particular": já abre citando a mensagem do grupo.
  useEffect(() => {
    if (!privateReply || privateReply.to !== chat.jid) return;
    setReplyTo(privateReply.message);
    setReplyFrom({ jid: privateReply.from.jid, name: privateReply.from.name, isGroup: privateReply.from.isGroup });
    requestAnimationFrame(() => composer.current?.focus());
  }, [privateReply, chat.jid]);
  useEffect(() => {
    const id = requestAnimationFrame(() => composer.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [chat.jid]);
  const ai = useAiStatus();
  const aiReady = isAiReady(ai);
  const usdBrl = useUsdBrl();
  const [drafting, setDrafting] = useState(false);
  const suggest = async () => {
    // Com texto no campo, a IA revisa o que foi escrito em vez de sugerir outra resposta.
    const own = draft.trim();
    setDrafting(true);
    try {
      const { text } = await api.draft(chat.jid, own || undefined);
      setDraft(text);
      requestAnimationFrame(() => composer.current?.focus());
    } catch (e) {
      notify("error", `A ${aiName(ai)} não ${own ? "revisou o texto" : "sugeriu resposta"}. ${(e as Error).message}`);
    } finally {
      setDrafting(false);
    }
  };
  // "Responder" no resumo de um áudio pede o rascunho desta conversa.
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  useEffect(() => {
    const onSuggest = (e: Event) => {
      if ((e as CustomEvent<{ chatJid: string }>).detail.chatJid === chat.jid) void suggestRef.current();
    };
    window.addEventListener("inbox:suggest", onSuggest);
    return () => window.removeEventListener("inbox:suggest", onSuggest);
  }, [chat.jid]);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffset = useRef<number | null>(null);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    stickToBottom.current = !focus;
    (focus ? api.messagesAround(chat.jid, focus.id) : api.messages(chat.jid))
      .then((list) => {
        if (!alive) return;
        // Abre já rolado e destacado na mensagem achada (ver o useLayoutEffect abaixo).
        pendingFocus.current = focus?.id ?? null;
        setMessages(list);
        setHasMore(focus ? true : list.length >= 80);
      })
      .catch((e) => alive && notify("error", e.message));
    return () => {
      alive = false;
    };
  }, [chat.jid, notify, focus]);

  // Rascunho por conversa: volta ao abrir e é guardado enquanto digita (não durante uma edição).
  useEffect(() => setDraft(drafts.get(chat.jid)), [chat.jid]);
  useEffect(() => {
    if (!editing) drafts.set(chat.jid, draft);
  }, [chat.jid, draft, editing]);

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
    if (pendingFocus.current) {
      const id = pendingFocus.current;
      pendingFocus.current = null;
      jump(id);
    } else if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (chat.unread <= 0 && !chat.markedUnread) return;
    onChat({ ...chat, unread: 0, markedUnread: false });
    api.read(chat.jid).then(onChat).catch(() => undefined);
  }, [chat.jid, chat.unread, chat.markedUnread, onChat]);

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

  type Outgoing = { text: string; quotedId?: string; quotedChat?: string; mentions: string[]; mentionAll?: boolean };
  const pendingSeq = useRef(0);
  // Payload de cada bolha otimista, para "Tentar de novo".
  const outbox = useRef(new Map<string, Outgoing>());
  const deliver = useCallback(
    async (localId: string) => {
      const out = outbox.current.get(localId);
      if (!out) return;
      const startedAt = Date.now();
      setMessages((list) => list && list.map((x) => (x.id === localId ? { ...x, pending: "sending" } : x)));
      // Se a bolha já foi trocada pela real (SSE) ou a real já está no fim da conversa, some com a local.
      const settle = (fresh: Message[]) => {
        const sent = fresh.some((x) => x.fromMe && x.text === out.text && x.at >= startedAt - 5_000);
        setMessages((list) => {
          if (!list) return list;
          const merged = mergeTail(list, fresh);
          return sent ? merged.filter((x) => x.id !== localId) : merged;
        });
        return sent;
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Sem resposta do servidor em 6 s: confere se saiu mesmo assim antes de marcar falha.
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("O servidor não confirmou o envio.")), 6_000);
        });
        const updated = await Promise.race([
          api.send(chat.jid, out.text, { quotedId: out.quotedId, quotedChat: out.quotedChat, mentions: out.mentions.length ? out.mentions : undefined, mentionAll: out.mentionAll }),
          timeout,
        ]);
        clearTimeout(timer);
        outbox.current.delete(localId);
        onChat(updated);
        // A versão real chega pelo SSE e já substitui a bolha; se não chegou, recarrega o fim da conversa.
        setMessages((list) => list && list.filter((x) => x.id !== localId));
        api.messages(chat.jid).then(
          (fresh) => setMessages((list) => (list ? mergeTail(list, fresh) : list)),
          () => undefined,
        );
      } catch (e) {
        clearTimeout(timer);
        const sent = await api.messages(chat.jid).then(settle, () => false);
        if (sent) {
          outbox.current.delete(localId);
          return;
        }
        setMessages((list) => list && list.map((x) => (x.id === localId && x.pending === "sending" ? { ...x, pending: "failed" } : x)));
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
    // Resposta em particular: a citada é do grupo; anexo e voz saem sem a citação.
    const quotedChat = replyTo && replyFrom ? replyFrom.jid : undefined;
    const mediaQuotedId = quotedChat ? undefined : quotedId;
    const quoteIsGroup = replyFrom ? replyFrom.isGroup : chat.isGroup;
    if (!attachments.length) {
      // Otimista: a bolha aparece na hora e o campo libera; o servidor confirma depois.
      const withMentions = applyMentions(text, picks.current);
      const localId = `local-${++pendingSeq.current}`;
      const quoted = replyTo
        ? { id: replyTo.id, text: splitAuthor(replyTo, quoteIsGroup).body, fromMe: replyTo.fromMe, author: replyTo.fromMe ? null : splitAuthor(replyTo, quoteIsGroup).author }
        : null;
      // "@todos" (ou "@all") digitado à mão também menciona o grupo inteiro.
      const mentionAll = chat.isGroup && (withMentions.mentionAll || /(^|\s)@(todos|all)(?=$|[\s.,;:!?])/i.test(text));
      outbox.current.set(localId, { text: withMentions.text, quotedId, quotedChat, mentions: withMentions.mentions, mentionAll: mentionAll || undefined });
      setMessages((list) => [
        ...(list ?? []),
        { chatJid: chat.jid, id: localId, fromMe: true, at: Date.now(), text: withMentions.text, kind: "text", media: null, contacts: null, quoted, deleted: false, sender: null, ack: null, editedAt: null, reactions: [], extra: null, poll: null, starred: false, pending: "sending" },
      ]);
      setDraft("");
      setReplyTo(null);
      setReplyFrom(null);
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
        onChat(await api.sendMedia(chat.jid, i === 0 && mediaQuotedId ? { ...file, quotedId: mediaQuotedId } : file));
        removeAttachment(a.id);
      }
      setDraft("");
      setReplyTo(null);
      setReplyFrom(null);
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
      onChat(await api.sendMedia(chat.jid, replyTo && !replyFrom ? { ...voice, quotedId: replyTo.id } : voice));
      setReplyTo(null);
      setReplyFrom(null);
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

  // ":" + 2 letras abre as sugestões de emoji (":joinha" → 👍), como no WhatsApp.
  const emojiQ = showQuick || showMention ? null : emojiQuery(draft, caret);
  const emojiData = useEmojiData(emojiQ !== null);
  const emojiItems = emojiQ !== null && emojiData && !emojiClosed ? searchEmoji(emojiQ, emojiData.EMOJIS, 8) : [];
  const showEmoji = emojiItems.length > 0;
  useEffect(() => {
    setEmojiActive(0);
    setEmojiClosed(false);
  }, [emojiQ]);
  const pickEmoji = (e: Emoji) => {
    const next = insertEmojiShortcut(draft, caret, e.char);
    rememberEmoji(e.char);
    setDraft(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  // Botão de emoji: entra no lugar da seleção do campo; o painel continua aberto para mais de um.
  const insertEmoji = (emoji: string) => {
    const el = composer.current;
    const start = el?.selectionStart ?? draft.length;
    const next = insertAt(draft, start, el?.selectionEnd ?? start, emoji);
    setDraft(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => composer.current?.setSelectionRange(next.caret, next.caret));
  };

  // ---- ações da mensagem (callbacks estáveis para o memo de <Messages>)

  /** Reinicia uma animação de uma vez na linha da mensagem (pular para a citada, reagir). */
  const flashRow = useCallback((id: string, cls: string) => {
    const row = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.classList.remove(cls);
    void row.offsetWidth;
    row.classList.add(cls);
  }, []);

  const reply = useCallback((m: Message) => {
    setReplyTo(m);
    setReplyFrom(null);
    requestAnimationFrame(() => composer.current?.focus());
  }, []);
  const copy = useCallback(
    // quiet: o botão da bolha confirma no próprio ícone; o menu ainda usa o toast.
    (m: Message, quiet = false) => {
      // Mídia: copia só a legenda, sem o "[Imagem]" do começo.
      const text = captionOf(m, splitAuthor(m, chat.isGroup).body);
      return navigator.clipboard.writeText(text).then(
        () => {
          if (!quiet) notify("success", "Texto copiado.");
          return true;
        },
        () => {
          notify("error", "Não foi possível copiar.");
          return false;
        },
      );
    },
    [chat.isGroup, notify],
  );
  const copyFile = useCallback(
    (m: Message) =>
      void copyMedia(m).then(
        (done) => notify("success", done),
        (e: Error) => notify("error", e.message),
      ),
    [notify],
  );
  const askDelete = useCallback((m: Message) => setDeleting(m), []);
  const replaceMessage = (updated: Message) => setMessages((list) => list && list.map((x) => (x.id === updated.id ? updated : x)));
  const react = useCallback(
    async (m: Message, emoji: string) => {
      const reactions = [...m.reactions.filter((r) => !r.fromMe), ...(emoji ? [{ emoji, fromMe: true }] : [])];
      setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
      if (emoji) requestAnimationFrame(() => flashRow(m.id, "message-row--reacted"));
      try {
        const updated = await api.react(chat.jid, m.id, emoji);
        setMessages((list) => list && list.map((x) => (x.id === updated.id ? updated : x)));
      } catch (e) {
        setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, reactions: m.reactions } : x)));
        notify("error", `Reação não enviada. ${(e as Error).message}`);
      }
    },
    [chat.jid, notify, flashRow],
  );
  const forward = useCallback((m: Message) => setForwarding([m]), []);
  const copyText = useCallback(
    (text: string) => void navigator.clipboard.writeText(text).then(() => notify("success", "Número copiado."), () => notify("error", "Não foi possível copiar.")),
    [notify],
  );
  const openContact = useCallback(
    (digits: string) => void api.openChat({ phone: digits }).then(onOpen, (e: Error) => notify("error", `Não foi possível abrir a conversa. ${e.message}`)),
    [onOpen, notify],
  );
  const startSelect = useCallback((m: Message) => setSelected(new Set(m.pending || m.deleted ? [] : [m.id])), []);
  const toggleSelect = useCallback(
    (m: Message) =>
      setSelected((cur) => {
        if (!cur) return cur;
        const next = new Set(cur);
        if (!next.delete(m.id)) next.add(m.id);
        return next;
      }),
    [],
  );
  // Na ordem da conversa, como o WhatsApp copia e encaminha.
  const selectedMessages = useMemo(() => (selected && messages ? messages.filter((m) => selected.has(m.id)) : []), [selected, messages]);
  const copySelected = useCallback(() => {
    const text = selectionText(selectedMessages, (m) => {
      const { author, body } = splitAuthor(m, chat.isGroup);
      return { author: m.fromMe ? "Você" : (chat.isGroup ? author : chat.name) ?? "Participante", text: m.media ? body : captionOf(m, body) };
    });
    void navigator.clipboard.writeText(text).then(
      () => {
        notify("success", selectedMessages.length === 1 ? "Mensagem copiada." : `${selectedMessages.length} mensagens copiadas.`);
        setSelected(null);
      },
      () => notify("error", "Não foi possível copiar."),
    );
  }, [selectedMessages, chat.isGroup, chat.name, notify]);
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !forwarding) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, forwarding]);
  const star = useCallback(
    async (m: Message) => {
      const starred = !m.starred;
      setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, starred } : x)));
      try {
        const { message, synced } = await api.star(chat.jid, m.id, starred);
        if (message) setMessages((list) => list && list.map((x) => (x.id === message.id ? message : x)));
        notify(synced ? "success" : "error", synced ? (starred ? "Mensagem favoritada." : "Mensagem tirada das favoritas.") : `Mensagem ${starred ? "favoritada" : "desfavoritada"} só neste computador. O celular não confirmou.`);
      } catch (e) {
        setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, starred: m.starred } : x)));
        notify("error", `Não foi possível ${starred ? "favoritar" : "desfavoritar"}. ${(e as Error).message}`);
      }
    },
    [chat.jid, notify],
  );
  const pin = useCallback(
    async (m: Message, seconds: number | null) => {
      try {
        onChat(await api.pin(chat.jid, m.id, seconds));
        notify("success", seconds ? "Mensagem fixada para todos." : "Mensagem desafixada.");
      } catch (e) {
        notify("error", `Não foi possível ${seconds ? "fixar" : "desafixar"}. ${(e as Error).message}`);
      }
    },
    [chat.jid, notify, onChat],
  );
  const unpin = useCallback(
    (id: string) => {
      const m = messages?.find((x) => x.id === id);
      void pin(m ?? ({ id } as Message), null);
    },
    [messages, pin],
  );
  const rich = useMemo<RichActions>(
    () => ({
      onVote: (m, options) => {
        // Otimista: o voto aparece na hora; volta se o WhatsApp recusar.
        const before = m;
        const mine = new Set(options);
        const poll = m.poll && {
          ...m.poll,
          options: m.poll.options.map((o) => {
            const was = o.mine;
            const now = mine.has(o.name);
            return { ...o, mine: now, count: o.count + (now && !was ? 1 : !now && was ? -1 : 0) };
          }),
        };
        if (poll) setMessages((list) => list && list.map((x) => (x.id === m.id ? { ...x, poll } : x)));
        api
          .vote(chat.jid, m.id, options)
          .then((updated) => updated && setMessages((list) => list && list.map((x) => (x.id === updated.id ? updated : x))))
          .catch((e: Error) => {
            setMessages((list) => list && list.map((x) => (x.id === before.id ? before : x)));
            notify("error", `Voto não enviado. ${e.message}`);
          });
      },
      onAcceptInvite: (m) => {
        api
          .acceptInvite(chat.jid, m.id)
          .then((group) => {
            notify("success", `Você entrou no grupo ${group.name}.`);
            onOpen(group);
          })
          .catch((e: Error) => notify("error", `Não foi possível entrar no grupo. ${e.message}`));
      },
    }),
    [chat.jid, notify, onOpen],
  );
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
  // ---- busca na conversa (Ctrl+F): procura nas mensagens já carregadas
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const findHits = useMemo(() => {
    const q = normalize(findQuery.trim());
    if (!q || !messages) return [];
    return messages
      .filter((m) => !m.deleted && normalize(captionOf(m, splitAuthor(m, chat.isGroup).body)).includes(q))
      .map((m) => m.id)
      .reverse(); // mais recente primeiro, como no WhatsApp
  }, [findQuery, messages, chat.isGroup]);
  const hitId = findOpen ? (findHits[Math.min(findIndex, findHits.length - 1)] ?? null) : null;
  useEffect(() => setFindIndex(0), [findQuery]);
  useEffect(() => {
    if (!hitId) return;
    scroller.current
      ?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(hitId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [hitId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findInput.current?.select());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const closeFind = () => {
    setFindOpen(false);
    setFindQuery("");
  };
  const stepFind = (dir: 1 | -1) => {
    if (!findHits.length) return;
    setFindIndex((i) => (Math.min(i, findHits.length - 1) + dir + findHits.length) % findHits.length);
  };
  const jump = useCallback(
    (id: string) => {
      const row = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
      if (!row) return notify("error", "A mensagem respondida é mais antiga. Use Carregar mensagens anteriores.");
      row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      flashRow(id, "message-row--flash");
    },
    [notify, flashRow],
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

  const change = async (patch: ChatPatch) => {
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
          <Button variant="ghost" className="chat-pane__back" aria-label="Voltar para a lista" icon={<ArrowLeft size={18} aria-hidden />} onClick={onBack} />
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
                  {chat.ephemeral && (
                    <span className="hint chat-pane__ephemeral" title="Mensagens temporárias ligadas. Mude no perfil da conversa.">
                      <Timer size={12} aria-hidden /> Temporárias: {ephemeralLabel(chat.ephemeral)}
                    </span>
                  )}
                </>
              )}
            </span>
          </button>
        </div>
        <div className="chat-pane__tools">
          <ClassificationBar
            chat={chat}
            labels={labels}
            onChange={change}
            onClassify={classify}
            classifying={classifying}
            jevReady={jevReady}
            classifierName={classifierName}
          />
          <span className="chat-pane__divider" aria-hidden />
          <Button
            variant="secondary"
            size="compact"
            className={`chat-pane__notes-toggle${chat.note || chat.reminderAt !== null ? " has-content" : ""}`}
            aria-pressed={notesOpen}
            aria-label={chat.note || chat.reminderAt !== null ? "Notas e lembretes (com conteúdo)" : "Notas e lembretes"}
            title="Notas e lembretes"
            onClick={() => setSide((v) => (v === "notes" ? null : "notes"))}
          >
            <StickyNote size={16} aria-hidden />
            <span className="chat-pane__notes-label">Notas</span>
            {chat.reminderAt !== null && <AlarmClock size={14} aria-hidden className="chat-pane__notes-alarm" />}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            aria-pressed={findOpen}
            aria-label="Pesquisar na conversa (Ctrl+F)"
            title="Pesquisar na conversa (Ctrl+F)"
            icon={<Search size={16} aria-hidden />}
            onClick={() => (findOpen ? closeFind() : (setFindOpen(true), requestAnimationFrame(() => findInput.current?.focus())))}
          />
          <AiQuickPicker onMore={onSetupAi} />
        </div>
      </header>
      {findOpen && (
        <div className="chat-find" role="search">
          <SearchBox
            ref={findInput}
            size="compact"
            className="chat-find__box"
            aria-label="Pesquisar nesta conversa"
            placeholder="Pesquisar nesta conversa"
            value={findQuery}
            autoFocus
            onChange={setFindQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepFind(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                // 1º Esc limpa o texto (SearchBox); com o campo vazio, fecha a barra.
                e.stopPropagation();
                if (!e.defaultPrevented) {
                  e.preventDefault();
                  closeFind();
                }
              }
            }}
          />
          <span className="chat-find__count" role="status" aria-live="polite">
            {findQuery.trim() ? (findHits.length ? `${Math.min(findIndex, findHits.length - 1) + 1} de ${findHits.length}` : "Nenhum resultado") : ""}
          </span>
          {findQuery.trim() && !findHits.length && hasMore && (
            <Button variant="ghost" size="compact" loading={loadingMore} onClick={loadMore}>
              Buscar em anteriores
            </Button>
          )}
          <div className="chat-find__nav">
            <Button variant="ghost" size="compact" aria-label="Resultado anterior" title="Anterior (Enter)" icon={<ChevronUp size={16} aria-hidden />} disabled={findHits.length < 2} onClick={() => stepFind(1)} />
            <Button variant="ghost" size="compact" aria-label="Próximo resultado" title="Próximo (Shift+Enter)" icon={<ChevronDown size={16} aria-hidden />} disabled={findHits.length < 2} onClick={() => stepFind(-1)} />
            <Button variant="ghost" size="compact" aria-label="Fechar pesquisa" title="Fechar (Esc)" icon={<X size={16} aria-hidden />} onClick={closeFind} />
          </div>
        </div>
      )}
      <PinnedBar key={chat.jid} chat={chat} canAct={connected} onJump={jump} onUnpin={unpin} />
      <div className="chat-pane__body">
      <div
        className="messages"
        ref={scroller}
        aria-live="polite"
        aria-busy={messages === null}
        // Só acompanha o fim quem já está lá: votar, reagir ou favoritar lá em cima não pode rolar a conversa.
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
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
            targetId={editing?.id ?? replyTo?.id ?? null}
            hitId={hitId}
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
            rich={rich}
            selected={selected}
            onToggleSelect={toggleSelect}
            onOpenContact={openContact}
            onCopyText={copyText}
          />
        )}
      </div>
      {notesOpen && <NotesPanel chat={chat} onChat={onChat} notify={notify} onClose={() => setSide(null)} />}
      {side === "profile" && profileTarget && <ProfilePanel target={profileTarget} chat={chat} connected={connected} onChat={onChat} notify={notify} onClose={() => setSide(null)} />}
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
          pinned={chat.pins.some((p) => p.id === menuAt.message.id && p.until > Date.now())}
          canPrivateReply={chat.isGroup && !menuAt.message.fromMe && !!menuAt.message.sender}
          actions={{ onReply: reply, onReact: react, onCopy: copy, onCopyMedia: copyFile, onView: viewMedia, onForward: forward, onEdit: edit, onDelete: askDelete, onAuthor: showAuthor, onStar: (m) => void star(m), onPin: (m, seconds) => void pin(m, seconds), onPrivateReply, onSelect: startSelect }}
          onClose={closeMenu}
        />
      )}
      {forwarding && (
        <ForwardDialog
          messages={forwarding}
          onClose={() => setForwarding(null)}
          onDone={(to) => {
            const n = forwarding.length;
            setForwarding(null);
            setSelected(null);
            const names = to.map((c) => c.name).join(", ");
            notify("success", n === 1 ? `Mensagem encaminhada para ${names}.` : `${n} mensagens encaminhadas para ${names}.`);
          }}
        />
      )}
      {pickingContact && (
        <ContactPicker
          to={chat}
          onClose={() => setPickingContact(false)}
          onDone={(n) => {
            setPickingContact(false);
            notify("success", n === 1 ? "Contato enviado." : `${n} contatos enviados.`);
          }}
        />
      )}
      {composeDialog === "poll" && <PollDialog onClose={() => setComposeDialog(null)} onSend={async (poll) => onChat(await api.sendPoll(chat.jid, poll))} />}
      {composeDialog === "location" && <LocationDialog onClose={() => setComposeDialog(null)} onSend={async (place) => onChat(await api.sendLocation(chat.jid, place))} />}
      {composeDialog === "sticker" && <StickerDialog onClose={() => setComposeDialog(null)} onSend={async (from) => onChat(await api.sendSticker(chat.jid, from))} />}
      {deleting && <DeleteDialog message={deleting} busy={false} onCancel={() => setDeleting(null)} onConfirm={(mode) => void confirmDelete(mode)} />}
      {selected && (
        <SelectionBar
          count={selectedMessages.length}
          canForward={connected}
          onCopy={copySelected}
          onForward={() => setForwarding(selectedMessages)}
          onCancel={() => setSelected(null)}
        />
      )}
      <form
        className="composer"
        style={selected ? { display: "none" } : undefined}
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
        {showEmoji && <EmojiShortcutMenu items={emojiItems} active={emojiActive} onPick={pickEmoji} onHover={setEmojiActive} />}
        {editing && <EditBar key={editing.id} message={editing} onCancel={cancelEdit} />}
        {replyTo && (
          <ReplyBar
            key={replyTo.id}
            message={replyTo}
            isGroup={replyFrom ? replyFrom.isGroup : chat.isGroup}
            chatName={replyFrom ? replyFrom.name : chat.name}
            onCancel={() => {
              setReplyTo(null);
              setReplyFrom(null);
            }}
          />
        )}
        {replyTo && replyFrom && <p className="hint reply-origin">Resposta em particular a uma mensagem de {replyFrom.name}</p>}
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
          <RecordingBar
            recorder={recorder}
            onError={(text) => notify("error", text)}
            onTranscript={(text) => {
              // A gravação vira texto: descarta o áudio e põe o texto no campo, para revisar e enviar.
              recorder.cancel();
              setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text));
            }}
          />
        ) : (
          <>
        <Button
          variant="ghost"
          aria-label="Anexar arquivo"
          title="Anexar imagem, vídeo ou documento (ou arraste para a conversa, ou cole com Ctrl+V)"
          disabled={!connected || sending}
          onClick={() => fileInput.current?.click()}
          icon={<Paperclip size={18} aria-hidden />}
        />
        <EmojiButton disabled={!connected} onPick={insertEmoji} onClose={() => composer.current?.focus()} />
        <Button
          variant="ghost"
          aria-label="Enviar contato"
          title="Enviar contato"
          disabled={!connected || sending}
          onClick={() => setPickingContact(true)}
          icon={<Contact size={18} aria-hidden />}
        />
        <Menu
          align="start"
          trigger={(t) => (
            <Button {...t} variant="ghost" aria-label="Enviar enquete, localização ou figurinha" title="Enquete, localização ou figurinha" disabled={!connected || sending} icon={<Plus size={18} aria-hidden />} />
          )}
          actions={[
            { id: "poll", label: "Enquete", icon: <ListChecks size={16} aria-hidden />, onSelect: () => setComposeDialog("poll") },
            { id: "location", label: "Localização", icon: <MapPin size={16} aria-hidden />, onSelect: () => setComposeDialog("location") },
            { id: "sticker", label: "Figurinha", icon: <Sticker size={16} aria-hidden />, onSelect: () => setComposeDialog("sticker") },
          ]}
        />
        <Button
          variant="ghost"
          aria-label="Respostas rápidas"
          title={quickReplies.length ? "Respostas rápidas (ou digite / no começo)" : "Cadastre respostas rápidas em Configurações"}
          disabled={!connected || !quickReplies.length}
          aria-expanded={showQuick}
          onClick={() => setQuickOpen((v) => !v)}
          icon={<Zap size={18} aria-hidden />}
        />
        <Button
          variant="ghost"
          aria-label={aiReady ? `${draft.trim() ? "Revisar texto" : "Sugerir resposta"} com a ${aiName(ai)}` : "Ativar a IA"}
          title={aiReady ? `${draft.trim() ? "Corrigir e formalizar o texto" : "Sugerir resposta"} (${aiName(ai)}, revise antes de enviar)` : "Ativar a IA para sugerir respostas"}
          disabled={drafting || !connected}
          aria-busy={drafting || undefined}
          onClick={() => (aiReady ? void suggest() : onSetupAi())}
          icon={drafting ? <LoaderCircle className="spin" size={18} aria-hidden /> : <WandSparkles size={18} aria-hidden />}
        />
        <div className="composer__field">
        <div className="composer__mirror" ref={mirror} aria-hidden>
          <WaLive text={draft} />
        </div>
        <textarea
          ref={composer}
          id="composer-text"
          rows={1}
          role="combobox"
          aria-expanded={showQuick || showMention || showEmoji}
          aria-controls={showQuick ? "quick-menu" : showMention ? "mention-menu" : showEmoji ? "emoji-menu" : undefined}
          aria-activedescendant={showQuick ? `quick-${quickItems[quickActive]?.shortcut}` : showMention ? `mention-${mentionActive}` : showEmoji ? `emoji-${emojiActive}` : undefined}
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
            const el = e.target;
            const at = el.selectionStart ?? el.value.length;
            // Emoticon digitado (":-)", "<3", "(y)") vira emoji na hora, como no WhatsApp Web.
            const swap = (e.nativeEvent as InputEvent).inputType === "insertText" ? convertEmoticon(el.value, at) : null;
            emoticonSwap.current = swap?.swap ?? null;
            setDraft(swap?.text ?? el.value);
            setCaret(swap?.swap.caret ?? at);
            if (swap) requestAnimationFrame(() => el.setSelectionRange(swap.swap.caret, swap.swap.caret));
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
            const swap = emoticonSwap.current;
            if (swap && e.key === "Backspace" && e.currentTarget.selectionStart === swap.caret && e.currentTarget.selectionEnd === swap.caret) {
              const undo = undoEmoticon(draft, swap);
              emoticonSwap.current = null;
              if (undo) {
                e.preventDefault();
                const el = e.currentTarget;
                setDraft(undo.text);
                setCaret(undo.caret);
                requestAnimationFrame(() => el.setSelectionRange(undo.caret, undo.caret));
                return;
              }
            }
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
            if (showEmoji) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setEmojiActive((i) => (i + step + emojiItems.length) % emojiItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickEmoji(emojiItems[emojiActive] ?? emojiItems[0]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setEmojiClosed(true);
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
          <Button
            variant="primary"
            type={recorder.recording ? "button" : "submit"}
            onClick={recorder.recording ? () => void sendVoice() : undefined}
            disabled={!connected || sending}
            loading={sending}
            icon={<SendHorizontal size={18} aria-hidden />}
          >
            <span className="composer__label">Enviar</span>
          </Button>
        ) : (
          <Button variant="primary" className="composer__mic" disabled={!connected} aria-label="Gravar mensagem de voz" title="Gravar mensagem de voz" icon={<Mic size={18} aria-hidden />} onClick={() => void recorder.start()} />
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
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);
  const [privateReply, setPrivateReply] = useState<PrivateReply | null>(null);
  const [dialog, setDialog] = useState<"new-chat" | "starred" | null>(null);
  const openChat = useCallback((jid: string | null) => {
    setFocus(null);
    setPrivateReply(null);
    setSelected(jid);
  }, []);
  const openAt = useCallback((jid: string, id: string) => {
    setSelected(jid);
    setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 }));
  }, []);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const visible = useRef<string[]>([]);
  const onVisible = useCallback((jids: string[]) => {
    visible.current = jids;
  }, []);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsUsed = useRef(false);
  if (settingsOpen) settingsUsed.current = true;
  const [settingsTab, setSettingsTab] = useState<"geral" | "ia" | "conta" | undefined>(undefined);
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

  /** Abre uma conversa que pode ser nova (número, contato recebido, grupo em que entrou). */
  const openTarget = useCallback(
    (target: { phone: string } | Chat) => {
      if ("jid" in target) {
        upsert(target);
        return openChat(target.jid);
      }
      api
        .openChat(target)
        .then((chat) => {
          upsert(chat);
          openChat(chat.jid);
        })
        .catch((e: Error) => push("error", `Não foi possível abrir a conversa. ${e.message}`));
    },
    [upsert, openChat, push],
  );

  /** "Responder em particular": abre a conversa com quem escreveu no grupo, já citando a mensagem. */
  const startPrivateReply = useCallback(
    (m: Message) => {
      const group = chats.get(m.chatJid);
      if (!m.sender || !group) return;
      api
        .openChat({ jid: m.sender })
        .then((chat) => {
          upsert(chat);
          openChat(chat.jid);
          setPrivateReply({ to: chat.jid, message: m, from: { jid: group.jid, name: group.name, isGroup: true } });
        })
        .catch((e: Error) => push("error", `Não foi possível abrir a conversa em particular. ${e.message}`));
    },
    [chats, upsert, openChat, push],
  );

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
    es.addEventListener("audio-summary", (e) => window.dispatchEvent(new CustomEvent("inbox:audio-summary", { detail: JSON.parse((e as MessageEvent).data) })));
    es.addEventListener("audio-status", (e) => window.dispatchEvent(new CustomEvent("inbox:audio-status", { detail: JSON.parse((e as MessageEvent).data) })));
    es.addEventListener("transcript", (e) => window.dispatchEvent(new CustomEvent("inbox:transcript", { detail: JSON.parse((e as MessageEvent).data) })));
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

  /** Ajuste vindo da lista ou do atalho; arquivar avisa com "Desfazer", como no WhatsApp. */
  const patchChat = useCallback(
    (jid: string, patch: ChatPatch) => {
      api
        .update(jid, patch)
        .then((c) => {
          upsert(c);
          // Marcar como não lida a conversa aberta fecha a conversa (senão ela seria lida de novo na hora).
          if (patch.markedUnread && jid === selectedRef.current) openChat(null);
          if (patch.archived === undefined) return;
          push("success", `${c.name} ${patch.archived ? "arquivada" : "desarquivada"}.`, {
            label: "Desfazer",
            run: () => patchChat(jid, { archived: !patch.archived }),
          });
        })
        .catch((err) => push("error", `Não foi possível atualizar a conversa. ${(err as Error).message}`));
    },
    [upsert, push, openChat],
  );

  // Atalhos globais (ver ShortcutsDialog). Dentro de campos, só Ctrl+K e Ctrl+E valem.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSelected(null);
        requestAnimationFrame(() => document.getElementById("chat-search")?.focus());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        const chat = selected ? chats.get(selected) : undefined;
        if (chat && !e.repeat) patchChat(chat.jid, { archived: !chat.archived });
        return;
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const list = visible.current;
        if (!list.length) return;
        e.preventDefault();
        const i = selected ? list.indexOf(selected) : -1;
        const next = e.key === "ArrowDown" ? Math.min(list.length - 1, i + 1) : Math.max(0, i === -1 ? 0 : i - 1);
        openChat(list[next]);
        return;
      }
      if (typing || e.altKey || e.repeat) return;
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && selected) {
        e.preventDefault();
        api
          .update(selected, { status: "resolvida" })
          .then((c) => {
            upsert(c);
            push("success", `${c.name} marcada como resolvida.`);
          })
          .catch((err) => push("error", `Não foi possível resolver. ${(err as Error).message}`));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, chats, openChat, upsert, push, patchChat]);

  // Clique na notificação abre a conversa; "Configurações" na bandeja abre o painel.
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    const offChat = bridge.onOpenChat((jid) => {
      setSkipConnect(true);
      openChat(jid);
    });
    const offSettings = bridge.onOpenSettings((tab) => {
      if (tab === "conta") setSettingsTab("conta");
      setSettingsOpen(true);
    });
    return () => {
      offChat();
      offSettings();
    };
  }, []);

  // Total de não lidas no ícone da barra de tarefas e na bandeja (só no app desktop).
  // Arquivadas não entram no selo da barra de tarefas, como no WhatsApp.
  const unreadTotal = useMemo(() => [...chats.values()].reduce((sum, c) => sum + (c.unread > 0 && !c.archived ? c.unread : 0), 0), [chats]);
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let alive = true;
    let media: MediaQueryList | null = null;
    const send = () => {
      if (!alive) return;
      bridge.setUnread(unreadTotal, unreadTotal > 0 ? badgeImage(unreadTotal) : null);
      // Redesenha no tamanho certo se a janela mudar para uma tela com outra escala.
      media?.removeEventListener("change", send);
      media = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", send);
    };
    send();
    // A Manrope só carrega quando usada; sem ela o canvas cairia na fonte padrão.
    if (unreadTotal > 0) void document.fonts.load(BADGE_FONT).then(send, () => {});
    return () => {
      alive = false;
      media?.removeEventListener("change", send);
    };
  }, [unreadTotal]);

  return (
    <div className="app" data-view={current ? "chat" : "list"}>
      {showConnect ? (
        <ConnectScreen connection={connection} onSkip={() => setSkipConnect(true)} />
      ) : (
        <>
          <ChatList
            chats={sorted}
            byJid={chats}
            labels={labels}
            selected={selected}
            onOpen={openChat}
            onOpenAt={openAt}
            onVisible={onVisible}
            connection={connection}
            online={online}
            onSettings={() => setSettingsOpen(true)}
            loaded={loaded}
            onPatch={patchChat}
            onNewChat={() => setDialog("new-chat")}
            onStarred={() => setDialog("starred")}
          />
          {current ? (
            <ChatView
              key={current.jid}
              chat={current}
              focus={focus}
              labels={labels}
              connected={online && connection.status === "conectado"}
              jevReady={!!state?.classifier.configured}
              classifierName={state?.classifier.provider === "deepseek" ? "DeepSeek" : "Jev"}
              onBack={() => openChat(null)}
              notify={push}
              onChat={upsert}
              onOpen={(c) => {
                upsert(c);
                openChat(c.jid);
              }}
              quickReplies={quickReplies}
              sendTyping={!!state?.prefs.sendTyping}
              privateReply={privateReply}
              onPrivateReply={startPrivateReply}
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
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {dialog === "new-chat" && <NewChatDialog onClose={() => setDialog(null)} onOpen={openTarget} />}
      {dialog === "starred" && <StarredDialog chats={chats} onClose={() => setDialog(null)} onOpenAt={openAt} />}
      <UpdateDialog
        onShowVersions={() => {
          setSettingsTab("geral");
          setSettingsOpen(true);
        }}
      />
      <Toasts toasts={toasts} dismiss={dismiss} />
      <div className="build-badge" aria-hidden="true">
        {formatBuild(__APP_VERSION__, __BUILD_DATE__)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
