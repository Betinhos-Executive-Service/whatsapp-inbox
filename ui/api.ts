export type Status = "aberta" | "aguardando" | "resolvida";

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
  ai: { label: string; confidence: number; needsReply: number; urgent: number; at: number } | null;
  aiError: string | null;
  note: string | null;
  reminderAt: number | null;
};

export type AiStatus = (
  | { state: "ausente" }
  | { state: "baixando"; percent: number }
  | { state: "pronto"; loaded: boolean }
  | { state: "erro"; message: string }
) & {
  modelId: "leve" | "melhor";
  model: string;
  size: number;
  models: { id: "leve" | "melhor"; name: string; size: number; installed: boolean }[];
  instructions: string;
  customInstructions: boolean;
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
  media: { type: string; mimetype: string; fileName: string | null; size: number | null } | null;
};

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
  update: (jid: string, patch: { status?: Status; label?: string | null; note?: string | null }) => request<Chat>("PATCH", chatPath(jid), patch),
  reminders: (jid: string) => request<Reminder[]>("GET", `${chatPath(jid)}/reminders`),
  addReminder: (jid: string, dueAt: number, text: string) => request<Reminder>("POST", `${chatPath(jid)}/reminders`, { dueAt, text }),
  doneReminder: (id: number) => request<Chat>("POST", `/api/reminders/${id}/done`, {}),
  deleteReminder: (id: number) => request<Chat>("DELETE", `/api/reminders/${id}`),
  ai: () => request<AiStatus>("GET", "/api/ai"),
  downloadAi: () => request<AiStatus>("POST", "/api/ai/download", {}),
  selectAi: (id: "leve" | "melhor") => request<AiStatus>("PUT", "/api/ai/model", { id }),
  removeAi: () => request<AiStatus>("DELETE", "/api/ai/model"),
  setAiInstructions: (text: string | null) => request<AiStatus>("PUT", "/api/ai/instructions", { text }),
  draft: (jid: string) => request<{ text: string }>("POST", `${chatPath(jid)}/draft`, {}),
  summary: (jid: string) => request<Summary>("POST", `${chatPath(jid)}/summary`, {}),
  quickReplies: () => request<QuickReply[]>("GET", "/api/quick-replies"),
  saveQuickReplies: (list: QuickReply[]) => request<QuickReply[]>("PUT", "/api/quick-replies", list),
  classify: (jid: string) => request<Chat>("POST", `${chatPath(jid)}/classify`, {}),
  saveLabels: (labels: Label[]) => request<Label[]>("PUT", "/api/labels", labels),
  saveSettings: (s: { jevApiKey?: string | null; autoClassify?: boolean; prefs?: Partial<Prefs> }) => request<AppState>("PUT", "/api/settings", s),
  logout: () => request<AppState>("POST", "/api/logout", {}),
  reset: (reconnect: boolean) => request<AppState>("POST", "/api/reset", { reconnect }),
};
