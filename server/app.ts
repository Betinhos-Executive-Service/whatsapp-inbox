import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type Chat, type Label, type Message, type QuickReply, type Reminder } from "./db.ts";
import { createHandler } from "./http.ts";
import { cacheMedia, loadMedia } from "./media.ts";
import { DEFAULT_INSTRUCTIONS } from "./ai.ts";
import { ClaudePlanAI, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, DEFAULT_CLAUDE_OPTIONS, findClaudeBin, isClaudeModel, parseClaudeOptions, runClaude, type ClaudeModel } from "./claude.ts";
import { PhotoCache } from "./photos.ts";
import { cachedAudioSummary, cachedTranscript, saveAudioSummary, saveTranscript, transcribeAudio } from "./groq.ts";
import type { AudioSummary } from "./ai.ts";
import { DeepSeekAI, DEEPSEEK_MODELS, DEFAULT_DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_OPTIONS, isDeepSeekModel, parseDeepSeekOptions, type DeepSeekModel } from "./deepseek.ts";
import { readPrefs, savePrefs, type Prefs } from "./prefs.ts";
import { DEFAULT_USD_BRL, estimateCostUsd, type Provider as UsageProvider, type TokenUsage, type UsageKind } from "./pricing.ts";
import { JEV_MODEL, type Jev } from "./jev.ts";
import type { ConnectionState, OutgoingFile, WhatsApp } from "./whatsapp.ts";

// A libsignal (dependência do Baileys) escreve no console o conteúdo das sessões
// criptográficas ("Closing session: SessionEntry {...}"). Isso não pode ir para log.
const LIBSIGNAL_NOISE = /^(Closing session|Opening session|Removing old closed session|Session already|Closing open session|Decrypted message with closed session|Migrating session)/;
for (const level of ["info", "warn", "log"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && LIBSIGNAL_NOISE.test(args[0])) return;
    original(...args);
  };
}

export type AppOptions = {
  dataDir: string;
  distDir: string;
  /** 0 = porta livre escolhida pelo sistema (app desktop). */
  port: number;
  /** Só para testar a interface sem WhatsApp. */
  waDisabled?: boolean;
  /** Mensagem recebida ao vivo (não histórico), para notificação do app. */
  onIncoming?: (chat: Chat, message: Message) => void;
  /** Preferências mudaram (e uma vez ao iniciar): o app desktop aplica inicialização etc. */
  onPrefs?: (prefs: Prefs) => void;
  /** Lembrete venceu: o app desktop mostra a notificação. */
  onReminder?: (chat: Chat, reminder: Reminder) => void;
  /** Conversa marcada como lida (na página ou pelo toast): o app desktop zera a notificação. */
  onRead?: (jid: string) => void;
  /** Conexão do WhatsApp mudou (QR, conectado…): o app desktop mostra no seletor de contas. */
  onConnection?: (state: ConnectionState) => void;
};

/** Configurações copiáveis entre contas: nunca conversas, número conectado ou auth. */
export type SettingsSnapshot = { settings: [key: string, value: string][]; labels: Label[]; quickReplies: QuickReply[] };

export type RunningApp = {
  port: number;
  /** Segredo desta execução para processos locais (servidor MCP) chamarem a API. */
  token: string;
  prefs: () => Prefs;
  send: (jid: string, text: string) => Promise<void>;
  markRead: (jid: string) => Promise<void>;
  avatar: (jid: string) => Promise<Buffer | null>;
  connection: () => ConnectionState;
  logout: () => Promise<void>;
  exportSettings: () => SettingsSnapshot;
  importSettings: (snapshot: SettingsSnapshot) => void;
  close: () => Promise<void>;
};

// Estado do número conectado: não vai junto ao copiar configurações para outra conta.
// "poll_lid…" (endereço das enquetes) também é do número: filtrado pelo prefixo.
const PER_NUMBER_SETTINGS = new Set(["account", "contacts_backfill", "wa_version"]);

export async function startApp(options: AppOptions): Promise<RunningApp> {
  mkdirSync(options.dataDir, { recursive: true });
  const store = new Store(join(options.dataDir, "inbox.db"));
  const disabled = !!options.waDisabled;
  let port = options.port;

  // Baileys e Jev levam ~2,5 s para carregar. A interface sobe antes; eles chegam em seguida.
  let wa: WhatsApp | null = null;
  let jevInstance: Promise<Jev> | null = null;
  const getJev = () => (jevInstance ??= import("./jev.ts").then((m) => new m.Jev()));
  const bootingState: ConnectionState = { status: "iniciando", qr: null, me: null, error: null };

  // ---- eventos ao vivo (SSE)

  const clients = new Set<ServerResponse>();
  function broadcast(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  }
  const heartbeat = setInterval(() => broadcast("ping", Date.now()), 25000);
  heartbeat.unref();

  // ---- lembretes: confere a cada 30 s (e logo ao abrir, para os que venceram com o app fechado)

  function fireReminders() {
    for (const { chat, reminder } of store.fireDueReminders()) {
      broadcast("chat", chat);
      broadcast("reminder", { chat, reminder });
      options.onReminder?.(chat, reminder);
    }
    // Conversa adiada que venceu avisa como um lembrete.
    const now = Date.now();
    for (const chat of store.wakeSnoozed(now)) {
      const reminder = { id: 0, chatJid: chat.jid, dueAt: now, text: "Conversa adiada voltou para Abertas.", firedAt: now };
      broadcast("chat", chat);
      broadcast("reminder", { chat, reminder });
      options.onReminder?.(chat, reminder);
    }
  }
  const reminderTimer = setInterval(fireReminders, 30000);
  reminderTimer.unref();

  // ---- IA: DeepSeek (nuvem, padrão) ou Claude pelo plano (Claude Code deste PC)

  const deepseekModel = (): DeepSeekModel => {
    const saved = store.getSetting("deepseek_model");
    return isDeepSeekModel(saved) ? saved : DEFAULT_DEEPSEEK_MODEL;
  };
  const deepseekOptions = () => parseDeepSeekOptions(store.getSetting("deepseek_options"));
  const deepseek = new DeepSeekAI(fetch, deepseekModel, deepseekOptions);
  const deepseekKey = () => process.env.DEEPSEEK_API_KEY || store.getSetting("deepseek_api_key");
  const groqKey = () => process.env.GROQ_API_KEY || store.getSetting("groq_api_key");
  const autoTranscribeAll = () => store.getSetting("auto_transcribe") === "1";
  /** A escolha da conversa vale mais que a global. */
  const shouldAutoTranscribe = (chat: Chat) => !!groqKey() && (chat.autoTranscribe ? chat.autoTranscribe === "on" : autoTranscribeAll());
  const claudeModel = (): ClaudeModel => {
    const saved = store.getSetting("claude_model");
    return isClaudeModel(saved) ? saved : DEFAULT_CLAUDE_MODEL;
  };
  const claudeOptions = () => parseClaudeOptions(store.getSetting("claude_options"));
  // Pasta própria: a pessoa pode pôr ali um CLAUDE.md só de atendimento.
  const claude = new ClaudePlanAI(join(options.dataDir, "claude"), claudeModel, findClaudeBin, runClaude, claudeOptions);
  type Provider = "deepseek" | "claude";
  // "local" salvo de versões antigas (IA offline removida) cai na DeepSeek.
  const provider = (): Provider => (store.getSetting("ai_provider") === "claude" ? "claude" : "deepseek");

  /** IA do resumo (conversa e áudio): "same" segue a do rascunho. */
  type SummaryChoice = { provider: "same" | Provider; deepseekModel: DeepSeekModel; claudeModel: ClaudeModel };
  const summaryChoice = (): SummaryChoice => {
    let raw: Partial<SummaryChoice> = {};
    try {
      raw = JSON.parse(store.getSetting("summary_ai") ?? "{}") as Partial<SummaryChoice>;
    } catch {
      raw = {};
    }
    return {
      provider: raw.provider === "deepseek" || raw.provider === "claude" ? raw.provider : "same",
      deepseekModel: isDeepSeekModel(raw.deepseekModel) ? raw.deepseekModel : deepseekModel(),
      claudeModel: isClaudeModel(raw.claudeModel) ? raw.claudeModel : claudeModel(),
    };
  };
  /** Quem resume de fato, e com qual modelo. */
  const summaryTarget = (): { provider: Provider; model: string } => {
    const c = summaryChoice();
    if (c.provider === "same") return provider() === "claude" ? { provider: "claude", model: claudeModel() } : { provider: "deepseek", model: deepseekModel() };
    return c.provider === "claude" ? { provider: "claude", model: c.claudeModel } : { provider: "deepseek", model: c.deepseekModel };
  };
  const summaryDeepseek = new DeepSeekAI(fetch, () => summaryTarget().model as DeepSeekModel, deepseekOptions);
  const summaryClaude = new ClaudePlanAI(join(options.dataDir, "claude"), () => summaryTarget().model as ClaudeModel, findClaudeBin, runClaude, claudeOptions);

  const aiInstructions = () => store.getSetting("ai_instructions") || DEFAULT_INSTRUCTIONS;
  const aiState = () => ({
    provider: provider(),
    deepseek: {
      configured: !!deepseekKey(),
      fromEnv: !!process.env.DEEPSEEK_API_KEY,
      model: deepseekModel(),
      models: (Object.keys(DEEPSEEK_MODELS) as DeepSeekModel[]).map((id) => ({ id, ...DEEPSEEK_MODELS[id] })),
      options: deepseekOptions(),
      defaults: DEFAULT_DEEPSEEK_OPTIONS,
    },
    claude: {
      configured: !!findClaudeBin(),
      model: claudeModel(),
      models: (Object.keys(CLAUDE_MODELS) as ClaudeModel[]).map((id) => ({ id, ...CLAUDE_MODELS[id] })),
      folder: join(options.dataDir, "claude"),
      options: claudeOptions(),
      defaults: DEFAULT_CLAUDE_OPTIONS,
    },
    jev: { contextMessages: jevContext() },
    summary: summaryChoice(),
    instructions: aiInstructions(),
    customInstructions: !!store.getSetting("ai_instructions"),
  });
  // ---- gastos com IA: cada chamada (inclusive falha) entra no painel de gastos

  const usdBrl = () => Number(store.getSetting("usd_brl")) || DEFAULT_USD_BRL;
  type UsageExtra = { label?: string; confidence?: number; needsReply?: number; urgent?: number; model?: string };
  function recordUsage(provider: UsageProvider, kind: UsageKind, jid: string | null, usage: TokenUsage | null, extra: UsageExtra = {}) {
    const at = Date.now();
    const u = usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    const model = extra.model ? (provider === "claude" ? `claude-${extra.model}` : extra.model) : provider === "deepseek" ? deepseekModel() : provider === "claude" ? `claude-${claudeModel()}` : provider === "jev" ? JEV_MODEL : provider;
    store.recordAiUsage({
      at, provider, kind, chatJid: jid, model,
      usage: u, costUsd: estimateCostUsd(provider, u, new Date(at), model),
      label: extra.label ?? null, confidence: extra.confidence ?? null, needsReply: extra.needsReply ?? null, urgent: extra.urgent ?? null,
      ok: usage !== null,
    });
    const chat = jid ? store.getChat(jid) : null;
    if (chat) broadcast("chat", chat);
  }
  /** Executa a geração e registra tokens; em falha registra a chamada sem tokens e repassa o erro. */
  async function tracked<T>(provider: UsageProvider, kind: UsageKind, jid: string, fn: () => Promise<{ usage: TokenUsage } & T>, model?: string): Promise<T> {
    try {
      const out = await fn();
      recordUsage(provider, kind, jid, out.usage, { model });
      return out;
    } catch (error) {
      recordUsage(provider, kind, jid, null, { model });
      throw error;
    }
  }

  const requireDeepseekKey = () => {
    const key = deepseekKey();
    if (!key) throw new Error("Cole a chave da DeepSeek em Configurações › IA.");
    return key;
  };
  /** Áudio já transcrito entra no contexto da IA como texto ("[Áudio] ..."), não só como "[Áudio]". */
  async function withTranscripts(jid: string, messages: Message[]): Promise<Message[]> {
    const dir = join(options.dataDir, "transcripts");
    return Promise.all(
      messages.map(async (m) => {
        if (m.media?.type !== "audio") return m;
        const text = await cachedTranscript(dir, jid, m.id);
        return text?.trim() ? { ...m, kind: "text", text: `[Áudio] ${text.trim()}` } : m;
      }),
    );
  }
  const chatOrThrow = async (jid: string, who: Provider = provider()) => {
    const chat = store.getChat(jid);
    if (!chat) throw new Error("Conversa não encontrada.");
    // Cada IA recebe a sua janela de mensagens (Configurações › IA).
    const window = who === "claude" ? claudeOptions().contextMessages : deepseekOptions().contextMessages;
    const messages = await withTranscripts(jid, store.listMessages(jid, null, window));
    if (!messages.some((m) => m.kind === "text")) throw new Error("A conversa não tem texto suficiente.");
    return { chat, messages };
  };

  // ---- Jev

  const jevKey = () => process.env.JEV_API_KEY || store.getSetting("jev_api_key");
  /** Mensagens enviadas ao Jev na classificação (10 a 100). */
  const jevContext = () => {
    const n = Number(store.getSetting("jev_context"));
    return Number.isInteger(n) && n >= 10 && n <= 100 ? n : 30;
  };
  const autoClassify = () => store.getSetting("auto_classify") !== "0";
  /** Quem classifica: Jev (padrão quando há chave) ou DeepSeek. Sem chave do escolhido, cai no outro. */
  type Classifier = "jev" | "deepseek";
  const classifier = (): Classifier => {
    const saved = store.getSetting("classify_provider");
    const wanted: Classifier = saved === "deepseek" ? "deepseek" : "jev";
    if (wanted === "jev" && !jevKey() && deepseekKey()) return "deepseek";
    if (wanted === "deepseek" && !deepseekKey() && jevKey()) return "jev";
    return wanted;
  };
  const classifierKey = () => (classifier() === "jev" ? jevKey() : deepseekKey());
  const classifierName = () => (classifier() === "jev" ? "Jev" : "DeepSeek");

  let queue = Promise.resolve();
  const pending = new Map<string, NodeJS.Timeout>();

  function classify(jid: string): Promise<Chat | null> {
    const run = queue.then(async () => {
      const which = classifier();
      const key = classifierKey();
      if (!key) throw new Error("Configure a chave do Jev ou da DeepSeek em Configurações › IA.");
      const chat = store.getChat(jid);
      if (!chat) throw new Error("Conversa não encontrada.");
      try {
        const messages = await withTranscripts(jid, store.listMessages(jid, null, which === "deepseek" ? deepseekOptions().contextMessages : jevContext()));
        const { result, usage } =
          which === "jev"
            ? await (await getJev()).classify(key, chat.name, messages, store.listLabels(), store.labelExamples(jid), jevContext())
            : await deepseek.classify(key, chat.name, messages, store.listLabels(), store.labelExamples(jid));
        recordUsage(which, "classificar", jid, usage, result);
        return store.saveClassification(jid, result);
      } catch (error) {
        const message = `${classifierName()} não classificou: ${error instanceof Error ? error.message : String(error)}`;
        recordUsage(which, "classificar", jid, null);
        store.saveClassificationError(jid, message);
        throw new Error(message);
      } finally {
        const updated = store.getChat(jid);
        if (updated) broadcast("chat", updated);
      }
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Espera a pessoa terminar de mandar mensagens antes de classificar (uma chamada por rajada). */
  function scheduleClassify(jid: string) {
    if (!classifierKey() || !autoClassify()) return;
    clearTimeout(pending.get(jid));
    pending.set(
      jid,
      setTimeout(() => {
        pending.delete(jid);
        classify(jid).catch(() => undefined);
      }, 15000),
    );
  }

  // ---- WhatsApp → interface

  const publicState = () => ({
    connection: disabled
      ? { status: "desconectado", qr: null, me: null, error: "WhatsApp desligado (WA_DISABLED=1)." }
      : (wa?.state ?? bootingState),
    jev: { configured: !!jevKey(), fromEnv: !!process.env.JEV_API_KEY, autoClassify: autoClassify() },
    classifier: { provider: classifier(), configured: !!classifierKey(), deepseekConfigured: !!deepseekKey() },
    groq: { configured: !!groqKey(), fromEnv: !!process.env.GROQ_API_KEY, autoTranscribe: autoTranscribeAll(), autoSummarize: autoSummarize() },
    prefs: readPrefs(store),
    labels: store.listLabels(),
  });

  async function startWhatsApp() {
    const { WhatsApp } = await import("./whatsapp.ts");
    const client = new WhatsApp(store, join(options.dataDir, "auth"));
    client.on("connection", (s) => {
      broadcast("connection", s);
      options.onConnection?.(s);
    });
    client.on("chat", (chat) => broadcast("chat", chat));
    client.on("update", (u) => broadcast("update", u));
    client.on("presence", (p) => broadcast("presence", p));
    client.on("reload", () => broadcast("reload", null));
    client.on("message", ({ message, chat, live }) => {
      broadcast("message", { message, chat });
      if (live && !message.fromMe) {
        // Ligação e avisos não mudam o assunto da conversa: não pedem classificação.
        if (message.kind !== "call" && message.kind !== "system") scheduleClassify(chat.jid);
        if (message.media?.type === "audio") readMedia(chat.jid, message.id).catch(() => undefined);
        if (message.media?.type === "audio" && shouldAutoTranscribe(chat)) {
          const ref = { chatJid: chat.jid, id: message.id };
          transcribe(chat.jid, message.id)
            .then(async (text) => {
              broadcast("transcript", { ...ref, text });
              if (!text.trim() || !autoSummarize() || (message.media?.seconds ?? 0) < AUTO_SUMMARY_SECONDS) return;
              broadcast("audio-status", { ...ref, state: "summarizing" });
              try {
                broadcast("audio-summary", { ...ref, summary: await summarizeAudio(chat.jid, message.id) });
              } catch (error) {
                broadcast("audio-status", { ...ref, state: "idle" });
                console.warn(`Resumo automático falhou: ${(error as Error).message}`);
              }
            })
            .catch((error: Error) => console.warn(`Transcrição automática falhou: ${error.message}`));
        }
        // Silenciada ou mantida no arquivo: chega e conta como não lida, só não avisa (como no WhatsApp).
        if (!chat.archived && (!chat.mutedUntil || chat.mutedUntil <= Date.now())) options.onIncoming?.(chat, message);
      }
    });
    wa = client;
    await client.start();
  }

  function connected(): WhatsApp {
    if (!wa) throw new Error("O WhatsApp ainda está iniciando. Tente de novo em instantes.");
    return wa;
  }

  async function readMedia(jid: string, id: string) {
    const ref = store.getMediaRef(jid, id);
    if (!ref) throw new Error("Esta mensagem não tem mídia salva. Mídias recebidas antes desta versão não podem ser abertas.");
    return loadMedia(join(options.dataDir, "media"), jid, id, ref);
  }

  /** Texto do áudio: do cache, ou transcreve na Groq e guarda. */
  async function transcribe(jid: string, id: string): Promise<string> {
    const dir = join(options.dataDir, "transcripts");
    const cached = await cachedTranscript(dir, jid, id);
    if (cached !== null) return cached;
    const key = groqKey();
    if (!key) throw new Error("Configure a chave da Groq em Configurações › IA para transcrever áudios.");
    const file = await readMedia(jid, id);
    if (!file.mimetype.startsWith("audio/")) throw new Error("Esta mensagem não é um áudio.");
    const text = await transcribeAudio(fetch, key, file.body, file.mimetype);
    await saveTranscript(dir, jid, id, text);
    return text;
  }

  /** Resumo organizado do áudio (assunto, pontos, tratativa e prioridade), pela IA escolhida para resumo. */
  async function summarizeAudio(jid: string, id: string, force = false): Promise<AudioSummary> {
    const dir = join(options.dataDir, "transcripts");
    const cached = force ? null : await cachedAudioSummary<AudioSummary>(dir, jid, id);
    if (cached) return cached;
    const transcript = await transcribe(jid, id);
    if (!transcript.trim()) throw new Error("O áudio não tem fala reconhecida para resumir.");
    const name = store.getChat(jid)?.name ?? "o contato";
    const target = summaryTarget();
    const { summary } = await tracked(
      target.provider,
      "resumo",
      jid,
      () => (target.provider === "claude" ? summaryClaude.summarizeAudio(name, transcript) : summaryDeepseek.summarizeAudio(requireDeepseekKey(), name, transcript)),
      target.model,
    );
    await saveAudioSummary(dir, jid, id, summary);
    applyAudioSummary(jid, id, summary);
    return summary;
  }

  /** O resumo vira prévia da conversa ("Áudio: assunto") e, se for alta, sobe a prioridade da conversa. */
  function applyAudioSummary(jid: string, id: string, summary: AudioSummary) {
    store.setAudioPreview(jid, id, `Áudio: ${summary.assunto}`);
    if (summary.prioridade === "alta" && !store.raisePriority(jid, summary.motivo || `Áudio: ${summary.assunto}`)) scheduleClassify(jid);
    const chat = store.getChat(jid);
    if (chat) broadcast("chat", chat);
  }

  const autoSummarize = () => store.getSetting("auto_summarize") === "1";
  /** Áudio curto não ganha resumo automático: a transcrição já basta. */
  const AUTO_SUMMARY_SECONDS = 15;

  async function sendMedia(jid: string, file: OutgoingFile, quotedId?: string) {
    const id = await connected().sendMedia(jid, file, { quoted: quotedId ? store.messageKey(jid, quotedId) : null });
    if (id) await cacheMedia(join(options.dataDir, "media"), jid, id, file.ptt ? "audio/ogg" : file.mimetype, file.body).catch(() => undefined);
  }

  const photos = new PhotoCache(join(options.dataDir, "photos"), store, {
    url: (jid, full) => (wa?.state.status === "conectado" ? wa.photoUrl(jid, full) : null),
  });

  /** WhatsApp apaga para todos só até ~2 dias e meio depois do envio. */
  const REVOKE_LIMIT_MS = 60 * 3_600_000;

  // ---- HTTP

  const send = async (jid: string, text: string) => {
    await connected().send(jid, text);
  };
  const markRead = async (jid: string) => {
    const wasMarked = store.clearMarkedUnread(jid);
    const keys = store.markRead(jid);
    broadcast("chat", store.getChat(jid));
    options.onRead?.(jid);
    await wa?.markRead(keys).catch(() => undefined); // recibo de leitura é cortesia, não bloqueia
    // Estava marcada como não lida: tira a marca também no celular.
    if (wasMarked) await wa?.syncUnread(jid, false).catch(() => undefined);
  };

  /** "11 99999-0000" ou "+55 11 99999-0000" → só dígitos com DDI; sem DDI, assume Brasil (55). */
  const phoneDigits = (phone: string): string => {
    let digits = phone.replace(/\D/g, "").replace(/^00/, "");
    if (!phone.trim().startsWith("+") && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
    if (digits.length < 8 || digits.length > 15) throw new Error("Número inválido. Use DDD e número, com DDI se for de fora do Brasil.");
    return digits;
  };

  /** Conversa nova ou existente: vira visível na lista e é avisada à tela. */
  const showChat = (jid: string) => {
    const chat = store.openChat(jid);
    broadcast("chat", chat);
    return chat;
  };
  const avatar = (jid: string) => photos.thumb(jid);

  // Muda a cada abertura do app; o arquivo de descoberta do MCP guarda o valor vigente.
  const token = randomBytes(32).toString("hex");
  const handler = createHandler({
    store,
    get port() {
      return port;
    },
    token,
    distDir: options.distDir,
    state: publicState,
    send: (jid, text, opts) =>
      connected().send(jid, text, { quoted: opts.quotedId ? store.messageKey(opts.quotedChat ?? jid, opts.quotedId) : null, mentions: opts.mentions, mentionAll: opts.mentionAll }),
    sendMedia,
    sendPoll: (jid, question, options, multiple) => connected().sendPoll(jid, question, options, multiple),
    vote: (jid, id, options) => connected().votePoll(jid, id, options),
    sendLocation: (jid, place) => connected().sendLocation(jid, place),
    sendContacts: (jid, contacts) => connected().sendContacts(jid, contacts),
    sendSticker: async (jid, from) => {
      const m = store.getMessage(from.chatJid, from.id);
      if (m?.media?.type !== "sticker") throw new Error("Figurinha não encontrada.");
      const file = await readMedia(from.chatJid, from.id);
      await sendMedia(jid, { body: file.body, mimetype: "image/webp", fileName: "figurinha.webp", sticker: true });
    },
    stickers: () => store.listStickers(),
    star: async (jid, id, starred) => ({ synced: await connected().star(jid, id, starred) }),
    pin: (jid, id, seconds) => connected().pinMessage(jid, id, seconds),
    openChat: async (target) => {
      if (target.phone) {
        const jid = await connected().checkNumber(phoneDigits(target.phone));
        if (!jid) throw new Error("Este número não tem WhatsApp. Confira o DDD e os dígitos.");
        return showChat(jid);
      }
      // Participante de grupo ou contato recebido: o número quando conhecido (o LID vira conversa também).
      return showChat(wa ? wa.conversationOf(target.jid!) : target.jid!);
    },
    setBlocked: (jid, blocked) => connected().setBlocked(jid, blocked),
    setEphemeral: (jid, seconds) => connected().setEphemeral(jid, seconds),
    syncUnread: (jid, unread) => {
      wa?.syncUnread(jid, unread).catch((e: Error) => console.warn(`Marcar como ${unread ? "não lida" : "lida"} no celular falhou: ${e.message}`));
    },
    createGroup: async (subject, participants) => showChat(await connected().createGroup(subject, participants)),
    updateParticipants: (jid, participants, action) => connected().updateParticipants(jid, participants, action),
    updateGroupInfo: async (jid, info) => {
      await connected().updateGroupInfo(jid, info);
      broadcast("chat", store.getChat(jid));
    },
    acceptInvite: async (jid, id) => showChat(await connected().acceptInvite(jid, id)),
    react: (jid, id, emoji) => connected().react(jid, id, emoji),
    editMessage: (jid, id, text) => connected().editSent(jid, id, text),
    forward: async (from, id, to) => {
      const m = store.getMessage(from, id);
      if (!m || m.deleted) throw new Error("Esta mensagem não pode ser encaminhada.");
      const text = store.messageText(from, id) ?? "";
      // Enquete e localização vão no próprio formato, não como texto "[Enquete] …".
      const extra = store.messageExtra(from, id);
      if (extra?.type === "poll") return connected().sendPoll(to, extra.question, extra.options, extra.selectable !== 1);
      if (extra?.type === "location") return connected().sendLocation(to, { lat: extra.lat, lng: extra.lng, name: extra.name ?? undefined, address: extra.address ?? undefined });
      const cards = m.contacts?.flatMap((c) => (c.phones[0] ? [{ name: c.name, phone: c.phones[0].wa ?? c.phones[0].number }] : []));
      if (cards?.length) return connected().sendContacts(to, cards);
      if (m.kind === "call" || m.kind === "system") throw new Error("Avisos e ligações não podem ser encaminhados.");
      if (m.media?.type === "sticker") {
        const file = await readMedia(from, id);
        return sendMedia(to, { body: file.body, mimetype: "image/webp", fileName: "figurinha.webp", sticker: true });
      }
      if (!m.media) return connected().send(to, text);
      // Mídia: baixa (ou lê do cache) e envia de novo, com a mesma legenda.
      const file = await readMedia(from, id);
      let caption = text.replace(/^\[[^\]]+\]\s*/, "");
      if (m.media.fileName && caption.startsWith(m.media.fileName)) caption = caption.slice(m.media.fileName.length).trim();
      await sendMedia(to, {
        body: file.body,
        mimetype: file.mimetype,
        fileName: file.fileName ?? m.media.fileName ?? "arquivo",
        caption: caption || undefined,
        ptt: m.media.ptt,
        seconds: m.media.seconds ?? undefined,
      });
    },
    watch: async (jid) => wa?.watchPresence(jid),
    typing: async (jid, state) => {
      if (readPrefs(store).sendTyping) await wa?.typing(jid, state);
    },
    markRead,
    syncArchive: (jid, archived) => {
      wa?.setArchived(jid, archived).catch((e: Error) => console.warn(`Arquivar no celular falhou: ${e.message}`));
    },
    syncMute: (jid, until) => {
      wa?.setMuted(jid, until).catch((e: Error) => console.warn(`Silenciar no celular falhou: ${e.message}`));
    },
    syncPin: (jid, pinned) => {
      wa?.setChatPinned(jid, pinned).catch((e: Error) => console.warn(`Fixar no celular falhou: ${e.message}`));
    },
    deleteMessage: async (jid, id, mode) => {
      const ref = store.messageKey(jid, id);
      if (!ref) throw new Error("Mensagem não encontrada.");
      if (mode === "everyone") {
        if (!ref.fromMe) throw new Error("Só dá para apagar para todos as mensagens que você enviou.");
        if (Date.now() - ref.at > REVOKE_LIMIT_MS) throw new Error("O WhatsApp só deixa apagar para todos até cerca de 2 dias depois do envio. Use Apagar para mim.");
        await connected().deleteForEveryone(ref);
        const message = store.markRevoked(jid, id);
        if (message) broadcast("update", { message, chat: store.getChat(jid) });
        return { synced: true };
      }
      // Para mim: tenta sincronizar com o celular; sai deste computador de qualquer forma.
      let synced = true;
      try {
        await connected().deleteForMe(ref);
      } catch {
        synced = false;
      }
      store.deleteMessage(jid, id);
      broadcast("remove", { chatJid: jid, id, chat: store.getChat(jid) });
      return { synced };
    },
    participants: (jid) => connected().participants(jid),
    profile: (jid) => connected().profile(jid),
    photo: (jid, full) => (full ? photos.full(jid) : photos.thumb(jid)),
    classify,
    saveSettings: (s) => {
      // Grava antes de avisar: sem onPrefs (modo navegador), `onPrefs?.(savePrefs(...))` nem gravava.
      if (s.prefs) {
        const saved = savePrefs(store, s.prefs);
        options.onPrefs?.(saved);
      }
      if (s.jevApiKey !== undefined) store.setSetting("jev_api_key", s.jevApiKey);
      if (s.groqApiKey !== undefined) store.setSetting("groq_api_key", s.groqApiKey);
      if (s.autoTranscribe !== undefined) store.setSetting("auto_transcribe", s.autoTranscribe ? "1" : "0");
      if (s.autoSummarize !== undefined) store.setSetting("auto_summarize", s.autoSummarize ? "1" : "0");
      if (s.deepseekApiKey !== undefined) {
        store.setSetting("deepseek_api_key", s.deepseekApiKey);
        broadcast("ai", aiState());
      }
      if (s.autoClassify !== undefined) store.setSetting("auto_classify", s.autoClassify ? "1" : "0");
      if (s.classifyProvider !== undefined) store.setSetting("classify_provider", s.classifyProvider);
      broadcast("state", publicState());
    },
    logout: () => connected().logout(),
    reset: async (reconnect) => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      store.clearConversations();
      broadcast("reload", null);
      // Desconectar e ler o QR de novo traz o histórico do número outra vez.
      if (reconnect) await connected().logout();
    },
    ai: {
      status: aiState,
      draft: async (jid, own = "") => {
        const { chat, messages } = await chatOrThrow(jid);
        const p = provider();
        const { text } = await tracked(p, "rascunho", jid, () =>
          p === "claude"
            ? claude.draft(chat.name, messages, aiInstructions(), own)
            : deepseek.draft(requireDeepseekKey(), chat.name, messages, aiInstructions(), own),
        );
        return text;
      },
      summarize: async (jid) => {
        const target = summaryTarget();
        const { chat, messages } = await chatOrThrow(jid, target.provider);
        const { summary } = await tracked(
          target.provider,
          "resumo",
          jid,
          () => (target.provider === "claude" ? summaryClaude.summarize(chat.name, messages) : summaryDeepseek.summarize(requireDeepseekKey(), chat.name, messages)),
          target.model,
        );
        return summary;
      },
      usage: (days) => store.aiUsageSummary(days === null ? null : Date.now() - days * 86_400_000, usdBrl()),
      setUsdBrl: (rate) => store.setSetting("usd_brl", rate === null ? null : String(rate)),
      setProvider: (p) => {
        store.setSetting("ai_provider", p);
        broadcast("ai", aiState());
      },
      setDeepseekModel: (model) => {
        store.setSetting("deepseek_model", model);
        broadcast("ai", aiState());
      },
      setClaudeModel: (model) => {
        store.setSetting("claude_model", model);
        broadcast("ai", aiState());
      },
      setSummaryModel: (choice) => {
        const current = summaryChoice();
        store.setSetting("summary_ai", JSON.stringify({ ...current, ...choice }));
        broadcast("ai", aiState());
      },
      setDeepseekOptions: (options) => {
        store.setSetting("deepseek_options", options ? JSON.stringify(options) : null);
        broadcast("ai", aiState());
      },
      setClaudeOptions: (options) => {
        store.setSetting("claude_options", options ? JSON.stringify(options) : null);
        broadcast("ai", aiState());
      },
      setJevContext: (n) => {
        store.setSetting("jev_context", n === null ? null : String(n));
        broadcast("ai", aiState());
      },
      setInstructions: (text) => {
        store.setSetting("ai_instructions", text?.trim() ? text.trim() : null);
        broadcast("ai", aiState());
      },
    },
    media: readMedia,
    transcribe,
    transcribeRecording: (body, mimetype) => {
      const key = groqKey();
      if (!key) return Promise.reject(new Error("Configure a chave da Groq em Configurações › IA para transcrever."));
      return transcribeAudio(fetch, key, body, mimetype);
    },
    cachedTranscript: async (jid, id) => {
      const dir = join(options.dataDir, "transcripts");
      const [text, summary] = await Promise.all([cachedTranscript(dir, jid, id), cachedAudioSummary(dir, jid, id)]);
      return { text, summary };
    },
    summarizeAudio,
    backup: async () => {
      const file = join(tmpdir(), `whatsapp-inbox-backup-${process.pid}-${Date.now()}.db`);
      store.db.prepare("vacuum into ?").run(file);
      return file;
    },
    subscribe: (res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res);
      res.on("close", () => clients.delete(res));
    },
    onChatChanged: (jid) => {
      if (jid === "*") broadcast("reload", null);
      else broadcast("chat", store.getChat(jid));
    },
  });

  const server = createServer(handler);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  port = (server.address() as AddressInfo).port;

  if (!disabled) startWhatsApp().catch((e) => process.stderr.write(`[whatsapp] ${e instanceof Error ? e.message : e}\n`));
  if (jevKey() && classifier() === "jev") void getJev();

  options.onPrefs?.(readPrefs(store));
  fireReminders();

  return {
    port,
    token,
    prefs: () => readPrefs(store),
    send,
    markRead,
    avatar,
    connection: () => (wa?.state ?? bootingState),
    logout: () => connected().logout(),
    exportSettings: () => ({
      settings: store.listSettings().filter(([key]) => !PER_NUMBER_SETTINGS.has(key) && !key.startsWith("poll_lid")),
      labels: store.listLabels(),
      quickReplies: store.listQuickReplies(),
    }),
    importSettings: (snapshot) => {
      for (const [key, value] of snapshot.settings) if (!PER_NUMBER_SETTINGS.has(key) && !key.startsWith("poll_lid")) store.setSetting(key, value);
      store.saveLabels(snapshot.labels);
      store.saveQuickReplies(snapshot.quickReplies);
      options.onPrefs?.(readPrefs(store));
      broadcast("state", publicState());
    },
    close: async () => {
      clearInterval(heartbeat);
      clearInterval(reminderTimer);
      for (const timer of pending.values()) clearTimeout(timer);
      await wa?.stop();
      for (const res of clients) res.end();
      // A janela mantém o SSE aberto: sem derrubar as conexões, close() nunca termina
      // (era o que travava a instalação de atualizações).
      const closed = new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections();
      await closed;
      store.db.close();
    },
  };
}
