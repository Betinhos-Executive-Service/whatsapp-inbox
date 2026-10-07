export type Status = "aberta" | "aguardando" | "resolvida";
export type Priority = "alta" | "media" | "baixa";
export type Classifier = "jev" | "deepseek";
export type DeepSeekModel = "deepseek-v4-pro" | "deepseek-flash";

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
export type UsageProvider = "jev" | "deepseek" | "local";
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

export type AiStatus = (
  | { state: "ausente" }
  | { state: "baixando"; id: "leve" | "melhor"; percent: number; downloaded: number; total: number; speed: number; eta: number | null }
  | { state: "pronto"; loaded: boolean }
  | { state: "erro"; message: string }
) & {
  modelId: "leve" | "melhor";
  model: string;
  size: number;
  models: { id: "leve" | "melhor"; name: string; size: number; installed: boolean; partial: boolean }[];
  instructions: string;
  customInstructions: boolean;
  provider: "deepseek" | "local";
  deepseek: { configured: boolean; fromEnv: boolean; model: DeepSeekModel; models: { id: DeepSeekModel; name: string; hint: string }[] };
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
};

/** Anexo saindo: conteúdo em base64 (a API só aceita JSON). */
export type OutgoingMedia = { fileName: string; mimetype: string; data: string; caption?: string; ptt?: boolean; seconds?: number };

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
  send: (jid: string, text: string) => request<Chat>("POST", `${chatPath(jid)}/send`, { text }),
  sendMedia: (jid: string, file: OutgoingMedia) => request<Chat>("POST", `${chatPath(jid)}/send-media`, file),
  update: (jid: string, patch: { status?: Status; label?: string | null; note?: string | null }) => request<Chat>("PATCH", chatPath(jid), patch),
  reminders: (jid: string) => request<Reminder[]>("GET", `${chatPath(jid)}/reminders`),
  addReminder: (jid: string, dueAt: number, text: string) => request<Reminder>("POST", `${chatPath(jid)}/reminders`, { dueAt, text }),
  doneReminder: (id: number) => request<Chat>("POST", `/api/reminders/${id}/done`, {}),
  deleteReminder: (id: number) => request<Chat>("DELETE", `/api/reminders/${id}`),
  ai: () => request<AiStatus>("GET", "/api/ai"),
  downloadAi: (id: "leve" | "melhor") => request<AiStatus>("POST", "/api/ai/download", { id }),
  cancelAiDownload: () => request<AiStatus>("POST", "/api/ai/download/cancel", {}),
  selectAi: (id: "leve" | "melhor") => request<AiStatus>("PUT", "/api/ai/model", { id }),
  removeAi: (id: "leve" | "melhor") => request<AiStatus>("POST", "/api/ai/remove", { id }),
  setAiProvider: (provider: "deepseek" | "local") => request<AiStatus>("PUT", "/api/ai/provider", { provider }),
  setDeepseekModel: (model: DeepSeekModel) => request<AiStatus>("PUT", "/api/ai/deepseek-model", { model }),
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
