export type Status = "aberta" | "aguardando" | "resolvida";

export type Chat = {
  jid: string;
  name: string;
  phone: string | null;
  lastAt: number;
  lastText: string | null;
  lastFromMe: boolean;
  unread: number;
  status: Status;
  label: string | null;
  labelSource: "manual" | "jev" | null;
  ai: { label: string; confidence: number; needsReply: number; urgent: number; at: number } | null;
  aiError: string | null;
};

export type Message = { chatJid: string; id: string; fromMe: boolean; at: number; text: string; kind: string };
export type Label = { name: string; description: string };
export type Connection = {
  status: "iniciando" | "qr" | "conectado" | "reconectando" | "desconectado";
  qr: string | null;
  me: string | null;
  error: string | null;
};
export type AppState = {
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
  update: (jid: string, patch: { status?: Status; label?: string | null }) => request<Chat>("PATCH", chatPath(jid), patch),
  classify: (jid: string) => request<Chat>("POST", `${chatPath(jid)}/classify`, {}),
  saveLabels: (labels: Label[]) => request<Label[]>("PUT", "/api/labels", labels),
  saveSettings: (s: { jevApiKey?: string | null; autoClassify?: boolean }) => request<AppState>("PUT", "/api/settings", s),
  logout: () => request<AppState>("POST", "/api/logout", {}),
  reset: (reconnect: boolean) => request<AppState>("POST", "/api/reset", { reconnect }),
};
