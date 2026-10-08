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
  /** Etiquetas extras escolhidas por você (a principal é `label`). */
  extraLabels: string[];
  pinnedAt: number | null;
  archived: boolean;
  mutedUntil: number | null;
  snoozedUntil: number | null;
  /** Transcrição automática: null segue a opção global. */
  autoTranscribe: "on" | "off" | null;
  /** Marcada como não lida (aqui ou no celular). */
  markedUnread: boolean;
  /** Mensagens temporárias: prazo em segundos; null = desligadas. */
  ephemeral: number | null;
  /** Mensagens fixadas que ainda valem, a mais recente primeiro. */
  pins: { id: string; until: number; text: string | null; fromMe: boolean }[];
};

export type CallInfo = { video: boolean; outcome: "ringing" | "missed" | "rejected" | "connected" | "elsewhere" | "failed"; seconds: number | null; group: boolean; outgoing: boolean };
/** Conteúdo além do texto: enquete, localização, contato, evento, convite, ligação, prévia de link. */
export type Extra =
  | { type: "poll"; question: string; options: string[]; selectable: number }
  | { type: "location"; lat: number; lng: number; name: string | null; address: string | null; url: string | null; live: boolean }
  | { type: "event"; name: string; description: string | null; start: number | null; end: number | null; place: string | null; link: string | null; canceled: boolean }
  | { type: "invite"; groupJid: string; groupName: string | null; code: string; expiration: number | null; caption: string | null }
  | ({ type: "call" } & CallInfo);

export type PollResult = { options: { name: string; count: number; mine: boolean; voters: string[] }[]; voters: number };

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
  /** IA do resumo (conversa e áudio); "same" segue a do rascunho. */
  summary: { provider: "same" | "deepseek" | "claude"; deepseekModel: DeepSeekModel; claudeModel: ClaudeModel };
};
export type Summary = { resumo: string; pedido: string; proximoPasso: string };
/** Resumo organizado de uma mensagem de voz. */
export type AudioSummary = { assunto: string; pontos: string[]; tratativa: string; prioridade: "alta" | "media" | "baixa"; motivo: string };

export type Reminder = { id: number; chatJid: string; dueAt: number; text: string; firedAt: number | null };
export type QuickReply = { shortcut: string; text: string };

export type ChatPatch = {
  status?: Status;
  label?: string | null;
  extraLabels?: string[];
  pinned?: boolean;
  archived?: boolean;
  mutedUntil?: number | null;
  snoozedUntil?: number | null;
  autoTranscribe?: "on" | "off" | null;
  markedUnread?: boolean;
};

/** Mensagem achada na busca; `snippet` marca o termo entre \u0002 e \u0003. */
export type SearchHit = { chatJid: string; id: string; at: number; fromMe: boolean; snippet: string };

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
  /** Cartões de contato (mensagem de contato). */
  contacts: ContactCard[] | null;
  /** Apagada para todos. */
  deleted: boolean;
  /** Autor em grupo (JID do participante), para abrir o perfil. */
  sender: string | null;
  /** Só nas enviadas: 1 pendente, 2 enviada, 3 entregue, 4 lida, 5 ouvida. */
  ack: number | null;
  editedAt: number | null;
  reactions: { emoji: string; fromMe: boolean }[];
  extra: Extra | null;
  /** Só em enquete: votos somados por opção. */
  poll: PollResult | null;
  /** Favoritada (estrela). */
  starred: boolean;
  /** Só no cliente: envio otimista ainda sem confirmação do servidor. */
  pending?: "sending" | "failed";
};

export type ContactCard = { name: string; phones: { number: string; wa: string | null }[] };

export type LinkPreview = { url: string; title: string; description: string | null; image: string | null; site: string };

/** Anexo saindo: conteúdo em base64 (a API só aceita JSON). */
export type OutgoingMedia = { fileName: string; mimetype: string; data: string; caption?: string; ptt?: boolean; seconds?: number; quotedId?: string };

export type Participant = { jid: string; name: string; phone: string | null; admin: boolean; me: boolean };
export type Profile = {
  about: string | null;
  aboutAt: number | null;
  blocked: boolean;
  group: {
    subject: string;
    description: string | null;
    createdAt: number | null;
    size: number;
    participants: Participant[];
    meAdmin: boolean;
    /** Só admins mudam nome e descrição. */
    restrict: boolean;
  } | null;
};
export type ParticipantAction = "add" | "remove" | "promote" | "demote";
export type ParticipantResult = { jid: string; ok: boolean; reason: string | null };

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
  /** Transcrição de áudio (Groq Whisper). */
  groq: { configured: boolean; fromEnv: boolean; autoTranscribe: boolean; autoSummarize: boolean };
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
  send: (jid: string, text: string, opts: { quotedId?: string; quotedChat?: string; mentions?: string[]; mentionAll?: boolean } = {}) =>
    request<Chat>("POST", `${chatPath(jid)}/send`, { text, ...opts }),
  sendPoll: (jid: string, poll: { question: string; options: string[]; multiple: boolean }) => request<Chat>("POST", `${chatPath(jid)}/poll`, poll),
  vote: (jid: string, id: string, options: string[]) => request<Message | null>("POST", `${chatPath(jid)}/vote`, { id, options }),
  sendLocation: (jid: string, place: { lat: number; lng: number; name?: string; address?: string }) => request<Chat>("POST", `${chatPath(jid)}/location`, place),
  sendSticker: (jid: string, from: { chatJid: string; id: string }) => request<Chat>("POST", `${chatPath(jid)}/sticker`, from),
  stickers: () => request<{ chatJid: string; id: string }[]>("GET", "/api/stickers"),
  star: (jid: string, id: string, starred: boolean) => request<{ message: Message | null; synced: boolean }>("POST", `${chatPath(jid)}/star`, { id, starred }),
  starred: () => request<Message[]>("GET", "/api/starred"),
  /** seconds null desafixa. */
  pin: (jid: string, id: string, seconds: number | null) => request<Chat>("POST", `${chatPath(jid)}/pin`, { id, seconds }),
  setEphemeral: (jid: string, seconds: number) => request<Chat>("POST", `${chatPath(jid)}/ephemeral`, { seconds }),
  setBlocked: (jid: string, blocked: boolean) => request<{ blocked: boolean }>("POST", `${chatPath(jid)}/block`, { blocked }),
  /** Conversa com um número (conferido no WhatsApp) ou com um contato/participante conhecido. */
  openChat: (target: { phone: string } | { jid: string }) => request<Chat>("POST", "/api/open-chat", target),
  createGroup: (subject: string, participants: string[]) => request<Chat>("POST", "/api/groups", { subject, participants }),
  updateParticipants: (jid: string, action: ParticipantAction, participants: string[]) =>
    request<ParticipantResult[]>("POST", `${chatPath(jid)}/participants`, { action, participants }),
  updateGroupInfo: (jid: string, info: { subject?: string; description?: string }) => request<Chat>("POST", `${chatPath(jid)}/group-info`, info),
  acceptInvite: (jid: string, id: string) => request<Chat>("POST", `${chatPath(jid)}/accept-invite`, { id }),
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
  update: (jid: string, patch: ChatPatch & { note?: string | null }) => request<Chat>("PATCH", chatPath(jid), patch),
  sendContacts: (jid: string, contacts: { name: string; phone: string }[]) => request<Chat>("POST", `${chatPath(jid)}/send-contacts`, { contacts }),
  linkPreview: (url: string) => request<LinkPreview | null>("GET", `/api/link-preview?url=${encodeURIComponent(url)}`),
  search: (q: string) => request<SearchHit[]>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  /** Da mensagem achada até a mais nova, para abrir a conversa nela. */
  messagesAround: (jid: string, id: string) => request<Message[]>("GET", `${chatPath(jid)}/messages?around=${encodeURIComponent(id)}`),
  reminders: (jid: string) => request<Reminder[]>("GET", `${chatPath(jid)}/reminders`),
  addReminder: (jid: string, dueAt: number, text: string) => request<Reminder>("POST", `${chatPath(jid)}/reminders`, { dueAt, text }),
  doneReminder: (id: number) => request<Chat>("POST", `/api/reminders/${id}/done`, {}),
  deleteReminder: (id: number) => request<Chat>("DELETE", `/api/reminders/${id}`, {}),
  ai: () => request<AiStatus>("GET", "/api/ai"),
  setAiProvider: (provider: AiStatus["provider"]) => request<AiStatus>("PUT", "/api/ai/provider", { provider }),
  setDeepseekModel: (model: DeepSeekModel) => request<AiStatus>("PUT", "/api/ai/deepseek-model", { model }),
  setSummaryModel: (choice: Partial<AiStatus["summary"]>) => request<AiStatus>("PUT", "/api/ai/summary-model", choice),
  setClaudeModel: (model: ClaudeModel) => request<AiStatus>("PUT", "/api/ai/claude-model", { model }),
  /** null volta tudo ao padrão. */
  setClaudeOptions: (options: ClaudeOptions | null) => request<AiStatus>("PUT", "/api/ai/claude-options", { options }),
  setJevContext: (messages: number | null) => request<AiStatus>("PUT", "/api/ai/jev-context", { messages }),
  /** null volta tudo ao padrão. */
  setDeepseekOptions: (options: DeepSeekOptions | null) => request<AiStatus>("PUT", "/api/ai/deepseek-options", { options }),
  setAiInstructions: (text: string | null) => request<AiStatus>("PUT", "/api/ai/instructions", { text }),
  aiUsage: (days: number | null) => request<AiUsageSummary>("GET", `/api/ai/usage?days=${days ?? "all"}`),
  setAiUsageRate: (rate: number) => request<{ ok: true }>("PUT", "/api/ai/usage/rate", { rate }),
  draft: (jid: string, text?: string) => request<{ text: string }>("POST", `${chatPath(jid)}/draft`, text ? { text } : {}),
  summary: (jid: string) => request<Summary>("POST", `${chatPath(jid)}/summary`, {}),
  quickReplies: () => request<QuickReply[]>("GET", "/api/quick-replies"),
  saveQuickReplies: (list: QuickReply[]) => request<QuickReply[]>("PUT", "/api/quick-replies", list),
  importQuickReplies: () =>
    request<{ list: QuickReply[]; added: number; updated: number; found: number }>("POST", "/api/quick-replies/import", {}),
  cachedTranscript: (jid: string, id: string) =>
    request<{ text: string | null; summary: AudioSummary | null }>("GET", `/api/transcribe/${encodeURIComponent(jid)}/${encodeURIComponent(id)}`),
  summarizeAudio: (jid: string, id: string, force = false) =>
    request<{ summary: AudioSummary }>("POST", `/api/transcribe/${encodeURIComponent(jid)}/${encodeURIComponent(id)}/summary`, force ? { force } : {}),
  transcribeRecording: (data: string, mimetype: string) => request<{ text: string }>("POST", "/api/transcribe-recording", { data, mimetype }),
  transcribe: (jid: string, id: string) =>
    request<{ text: string }>("POST", `/api/transcribe/${encodeURIComponent(jid)}/${encodeURIComponent(id)}`, {}),
  classify: (jid: string) => request<Chat>("POST", `${chatPath(jid)}/classify`, {}),
  saveLabels: (labels: Label[]) => request<Label[]>("PUT", "/api/labels", labels),
  saveSettings: (s: { jevApiKey?: string | null; deepseekApiKey?: string | null; groqApiKey?: string | null; autoTranscribe?: boolean; autoSummarize?: boolean; autoClassify?: boolean; classifyProvider?: Classifier; prefs?: Partial<Prefs> }) =>
    request<AppState>("PUT", "/api/settings", s),
  logout: () => request<AppState>("POST", "/api/logout", {}),
  reset: (reconnect: boolean) => request<AppState>("POST", "/api/reset", { reconnect }),
};
