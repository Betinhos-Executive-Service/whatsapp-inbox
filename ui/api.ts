export type Status = "aberta" | "aguardando" | "resolvida";
export type Priority = "alta" | "media" | "baixa";
export type Classifier = "jev" | "deepseek";
export type DeepSeekModel = "deepseek-v4-pro" | "deepseek-flash";
export type ClaudeModel = "sonnet" | "opus" | "fable" | "haiku";
export type ClaudeEffort = "default" | "low" | "medium" | "high" | "xhigh" | "max";
export type ClaudeOptions = { effort: ClaudeEffort; contextMessages: number; messageChars: number };
export type Theme = "system" | "light" | "dark";
export type Thinking = "off" | "low" | "high" | "max";
export type DeepSeekTask = "draft" | "summary" | "classify";
export type DeepSeekOptions = {
  thinking: Thinking;
  contextMessages: number;
  messageChars: number;
} & Record<DeepSeekTask, { maxTokens: number; temperature: number }>;

export type Chat = {
  jid: string;
  name: string;
  phone: string | null;
  isGroup: boolean;
  lastAt: number;
  lastText: string | null;
  lastFromMe: boolean;
  unread: number;
  status: Status;
  label: string | null;
  labelSource: "manual" | "jev" | null;
  ai: { label: string; confidence: number; needsReply: number; urgent: number; priority: Priority | null; reason: string | null; at: number } | null;
  aiError: string | null;
  note: string | null;
  reminderAt: number | null;
  /** Tokens e custo estimado (US$) de toda a IA usada nesta conversa. */
  aiUsage: { calls: number; tokens: number; costUsd: number };
};

export type UsageKind = "classificar" | "rascunho" | "resumo";
export type UsageProvider = "jev" | "deepseek" | "local" | "claude";
export type AiUsageSummary = {
  sinceAt: number | null;
  usdBrl: number;
  totals: { calls: number; failures: number; inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number };
  byKind: { kind: UsageKind; calls: number; tokens: number; costUsd: number }[];
  byProvider: { provider: UsageProvider; calls: number; tokens: number; costUsd: number }[];
  byDay: { day: string; calls: number; costUsd: number }[];
  classification: {
    total: number;
    failures: number;
    avgConfidence: number | null;
    needsReplyShare: number | null;
    urgentShare: number | null;
    byLabel: { label: string; count: number; avgConfidence: number }[];
  };
  topChats: { jid: string; name: string; calls: number; costUsd: number }[];
};

export type AiStatus = {
  instructions: string;
  customInstructions: boolean;
  provider: "deepseek" | "claude";
  deepseek: { configured: boolean; fromEnv: boolean; model: DeepSeekModel; models: { id: DeepSeekModel; name: string; hint: string }[]; options: DeepSeekOptions; defaults: DeepSeekOptions };
  claude: { configured: boolean; model: ClaudeModel; models: { id: ClaudeModel; name: string; hint: string }[]; folder: string; options: ClaudeOptions; defaults: ClaudeOptions };
  /** Janela de mensagens da classificação pelo Jev. */
  jev: { contextMessages: number };
};
export type Summary = { resumo: string; pedido: string; proximoPasso: string };

export type Reminder = { id: number; chatJid: string; dueAt: number; text: string; firedAt: number | null };
export type QuickReply = { shortcut: string; text: string };

export type Message = {
  chatJid: string;
  id: string;
  fromMe: boolean;
  at: number;
  text: string;
  kind: string;
  media: { type: string; mimetype: string; fileName: string | null; size: number | null; seconds: number | null; ptt: boolean } | null;
  /** Mensagem respondida (citação). */
  quoted: { id: string; text: string; fromMe: boolean; author: string | null } | null;
  /** Apagada para todos. */
  deleted: boolean;
  /** Autor em grupo (JID do participante), para abrir o perfil. */
  sender: string | null;
  /** Só nas enviadas: 1 pendente, 2 enviada, 3 entregue, 4 lida, 5 ouvida. */
  ack: number | null;
  editedAt: number | null;
  reactions: { emoji: string; fromMe: boolean }[];
};

/** Anexo saindo: conteúdo em base64 (a API só aceita JSON). */
export type OutgoingMedia = { fileName: string; mimetype: string; data: string; caption?: string; ptt?: boolean; seconds?: number; quotedId?: string };

export type Participant = { jid: string; name: string; phone: string | null; admin: boolean; me: boolean };
export type Profile = {
  about: string | null;
  aboutAt: number | null;
  group: { subject: string; description: string | null; createdAt: number | null; size: number; participants: Participant[] } | null;
};

/** Foto de perfil servida pelo app (miniatura em cache; full = tamanho cheio). */
export const photoUrl = (jid: string, full = false, v = 0) =>
  `/api/photo/${encodeURIComponent(jid)}${full ? "?full=1" : v ? `?v=${v}` : ""}`;

export const mediaUrl = (m: Message, download = false) =>
  `/api/media/${encodeURIComponent(m.chatJid)}/${encodeURIComponent(m.id)}${download ? "?download=1" : ""}`;
export type Label = { name: string; description: string };
export type Connection = {
  status: "iniciando" | "qr" | "conectado" | "reconectando" | "desconectado";
  qr: string | null;
  me: string | null;
  error: string | null;
};
export type Prefs = {
  notifyEnabled: boolean;
  notifySound: boolean;
  notifyPreview: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  startWithWindows: boolean;
  startMinimized: boolean;
  theme: Theme;
  sendTyping: boolean;
};
export type AppState = {
  prefs: Prefs;
  connection: Connection;
  jev: { configured: boolean; fromEnv: boolean; autoClassify: boolean };
  /** Quem classifica de fato (já com o fallback aplicado) e se tem chave. */
  classifier: { provider: Classifier; configured: boolean; deepseekConfigured: boolean };
  labels: Label[];
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Falha na comunicação com o app (${res.status}).`);
  return data as T;
}

const chatPath = (jid: string) => `/api/chats/${encodeURIComponent(jid)}`;

export const api = {
  state: () => request<AppState>("GET", "/api/state"),
  chats: () => request<Chat[]>("GET", "/api/chats"),
  messages: (jid: string, before?: number) =>
    request<Message[]>("GET", `${chatPath(jid)}/messages${before ? `?before=${before}` : ""}`),
  read: (jid: string) => request<Chat>("POST", `${chatPath(jid)}/read`, {}),
  send: (jid: string, text: string, opts: { quotedId?: string; mentions?: string[]; mentionAll?: boolean } = {}) =>
    request<Chat>("POST", `${chatPath(jid)}/send`, { text, ...opts }),
  deleteMessage: (jid: string, id: string, mode: "everyone" | "me") =>
    request<{ chat: Chat; synced: boolean }>("POST", `${chatPath(jid)}/delete`, { id, mode }),
  participants: (jid: string) => request<Participant[]>("GET", `${chatPath(jid)}/participants`),
  profile: (jid: string) => request<Profile>("GET", `/api/profile/${encodeURIComponent(jid)}`),
  /** Emoji vazio tira a reação. */
  react: (jid: string, id: string, emoji: string) => request<Message>("POST", `${chatPath(jid)}/react`, { id, emoji }),
  editMessage: (jid: string, id: string, text: string) => request<Message>("POST", `${chatPath(jid)}/edit`, { id, text }),
  forward: (jid: string, id: string, to: string) => request<Chat>("POST", `${chatPath(jid)}/forward`, { id, to }),
  watch: (jid: string) => request<{ ok: true }>("POST", `${chatPath(jid)}/watch`, {}),
  typing: (jid: string, state: "composing" | "paused") => request<{ ok: true }>("POST", `${chatPath(jid)}/typing`, { state }),
  sendMedia: (jid: string, file: OutgoingMedia) => request<Chat>("POST", `${chatPath(jid)}/send-media`, file),
  update: (jid: string, patch: { status?: Status; label?: string | null; note?: string | null }) => request<Chat>("PATCH", chatPath(jid), patch),
  reminders: (jid: string) => request<Reminder[]>("GET", `${chatPath(jid)}/reminders`),
  addReminder: (jid: string, dueAt: number, text: string) => request<Reminder>("POST", `${chatPath(jid)}/reminders`, { dueAt, text }),
  doneReminder: (id: number) => request<Chat>("POST", `/api/reminders/${id}/done`, {}),
  deleteReminder: (id: number) => request<Chat>("DELETE", `/api/reminders/${id}`),
  ai: () => request<AiStatus>("GET", "/api/ai"),
  setAiProvider: (provider: AiStatus["provider"]) => request<AiStatus>("PUT", "/api/ai/provider", { provider }),
  setDeepseekModel: (model: DeepSeekModel) => request<AiStatus>("PUT", "/api/ai/deepseek-model", { model }),
  setClaudeModel: (model: ClaudeModel) => request<AiStatus>("PUT", "/api/ai/claude-model", { model }),
  /** null volta tudo ao padrão. */
  setClaudeOptions: (options: ClaudeOptions | null) => request<AiStatus>("PUT", "/api/ai/claude-options", { options }),
  setJevContext: (messages: number | null) => request<AiStatus>("PUT", "/api/ai/jev-context", { messages }),
  /** null volta tudo ao padrão. */
  setDeepseekOptions: (options: DeepSeekOptions | null) => request<AiStatus>("PUT", "/api/ai/deepseek-options", { options }),
  setAiInstructions: (text: string | null) => request<AiStatus>("PUT", "/api/ai/instructions", { text }),
  aiUsage: (days: number | null) => request<AiUsageSummary>("GET", `/api/ai/usage?days=${days ?? "all"}`),
  setAiUsageRate: (rate: number) => request<{ ok: true }>("PUT", "/api/ai/usage/rate", { rate }),
  draft: (jid: string) => request<{ text: string }>("POST", `${chatPath(jid)}/draft`, {}),
  summary: (jid: string) => request<Summary>("POST", `${chatPath(jid)}/summary`, {}),
  quickReplies: () => request<QuickReply[]>("GET", "/api/quick-replies"),
  saveQuickReplies: (list: QuickReply[]) => request<QuickReply[]>("PUT", "/api/quick-replies", list),
  classify: (jid: string) => request<Chat>("POST", `${chatPath(jid)}/classify`, {}),
  saveLabels: (labels: Label[]) => request<Label[]>("PUT", "/api/labels", labels),
  saveSettings: (s: { jevApiKey?: string | null; deepseekApiKey?: string | null; autoClassify?: boolean; classifyProvider?: Classifier; prefs?: Partial<Prefs> }) =>
    request<AppState>("PUT", "/api/settings", s),
  logout: () => request<AppState>("POST", "/api/logout", {}),
  reset: (reconnect: boolean) => request<AppState>("POST", "/api/reset", { reconnect }),
};
