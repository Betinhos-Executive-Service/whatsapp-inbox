import { existsSync, mkdirSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type Chat, type Message, type Reminder } from "./db.ts";
import { createHandler } from "./http.ts";
import { loadMedia } from "./media.ts";
import { DEFAULT_INSTRUCTIONS, LocalAI, MODELS, type ModelId } from "./ai.ts";
import { DeepSeekAI, DEEPSEEK_MODEL } from "./deepseek.ts";
import { readPrefs, savePrefs, type Prefs } from "./prefs.ts";
import type { Jev } from "./jev.ts";
import type { ConnectionState, WhatsApp } from "./whatsapp.ts";

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
};

export type RunningApp = { port: number; prefs: () => Prefs; close: () => Promise<void> };

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
  }
  const reminderTimer = setInterval(fireReminders, 30000);
  reminderTimer.unref();

  // ---- IA: DeepSeek (nuvem, padrão quando há chave) ou local (modelo em data/models, offline)

  const deepseek = new DeepSeekAI();
  const deepseekKey = () => process.env.DEEPSEEK_API_KEY || store.getSetting("deepseek_api_key");
  type Provider = "deepseek" | "local";
  const provider = (): Provider => {
    const saved = store.getSetting("ai_provider");
    if (saved === "deepseek" || saved === "local") return saved;
    return deepseekKey() ? "deepseek" : "local";
  };

  const localAi = new LocalAI(join(options.dataDir, "models"), () => broadcast("ai", aiState()));
  const aiInstructions = () => store.getSetting("ai_instructions") || DEFAULT_INSTRUCTIONS;
  const savedModel = store.getSetting("ai_model");
  // Sem escolha salva: usa o que já estiver baixado (o melhor, se houver os dois).
  const installedNow = localAi.installed();
  // A escolha salva vale se o modelo existir; senão usa o que estiver baixado (o melhor, se houver os dois).
  const saved = savedModel === "leve" || savedModel === "melhor" ? savedModel : null;
  const initialModel: ModelId =
    saved && (installedNow.includes(saved) || !installedNow.length) ? saved : installedNow.includes("melhor") || !installedNow.length ? "melhor" : "leve";
  void localAi.select(initialModel);
  const aiState = () => ({
    ...localAi.status(),
    provider: provider(),
    deepseek: { configured: !!deepseekKey(), fromEnv: !!process.env.DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL },
    modelId: localAi.model_,
    model: MODELS[localAi.model_].name,
    size: MODELS[localAi.model_].size,
    models: (Object.keys(MODELS) as ModelId[]).map((id) => ({
      id,
      name: MODELS[id].name,
      size: MODELS[id].size,
      installed: localAi.installed().includes(id),
      partial: existsSync(join(options.dataDir, "models", `${MODELS[id].file}.ipull`)),
    })),
    instructions: aiInstructions(),
    customInstructions: !!store.getSetting("ai_instructions"),
  });
  const requireDeepseekKey = () => {
    const key = deepseekKey();
    if (!key) throw new Error("Cole a chave da DeepSeek em Configurações › IA.");
    return key;
  };
  const chatOrThrow = (jid: string) => {
    const chat = store.getChat(jid);
    if (!chat) throw new Error("Conversa não encontrada.");
    const messages = store.listMessages(jid, null, 40);
    if (!messages.some((m) => m.kind === "text")) throw new Error("A conversa não tem texto suficiente.");
    return { chat, messages };
  };

  // ---- Jev

  const jevKey = () => process.env.JEV_API_KEY || store.getSetting("jev_api_key");
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
        const messages = store.listMessages(jid, null, 30);
        const result =
          which === "jev"
            ? await (await getJev()).classify(key, chat.name, messages, store.listLabels(), store.labelExamples(jid))
            : await deepseek.classify(key, chat.name, messages, store.listLabels(), store.labelExamples(jid));
        return store.saveClassification(jid, result);
      } catch (error) {
        const message = `${classifierName()} não classificou: ${error instanceof Error ? error.message : String(error)}`;
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
    prefs: readPrefs(store),
    labels: store.listLabels(),
  });

  async function startWhatsApp() {
    const { WhatsApp } = await import("./whatsapp.ts");
    const client = new WhatsApp(store, join(options.dataDir, "auth"));
    client.on("connection", (s) => broadcast("connection", s));
    client.on("chat", (chat) => broadcast("chat", chat));
    client.on("reload", () => broadcast("reload", null));
    client.on("message", ({ message, chat, live }) => {
      broadcast("message", { message, chat });
      if (live && !message.fromMe) {
        scheduleClassify(chat.jid);
        options.onIncoming?.(chat, message);
      }
    });
    wa = client;
    await client.start();
  }

  function connected(): WhatsApp {
    if (!wa) throw new Error("O WhatsApp ainda está iniciando. Tente de novo em instantes.");
    return wa;
  }

  // ---- HTTP

  const handler = createHandler({
    store,
    get port() {
      return port;
    },
    distDir: options.distDir,
    state: publicState,
    send: (jid, text) => connected().send(jid, text),
    markRead: async (jid) => {
      const keys = store.markRead(jid);
      broadcast("chat", store.getChat(jid));
      await wa?.markRead(keys).catch(() => undefined); // recibo de leitura é cortesia, não bloqueia
    },
    classify,
    saveSettings: (s) => {
      if (s.prefs) options.onPrefs?.(savePrefs(store, s.prefs));
      if (s.jevApiKey !== undefined) store.setSetting("jev_api_key", s.jevApiKey);
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
      download: (id) => void localAi.download(id).then(() => store.setSetting("ai_model", localAi.model_)),
      cancel: () => localAi.cancelDownload(),
      remove: (id) => localAi.remove(id),
      draft: (jid) => {
        const { chat, messages } = chatOrThrow(jid);
        if (provider() === "local") return localAi.draft(chat.name, messages, aiInstructions());
        return deepseek.draft(requireDeepseekKey(), chat.name, messages, aiInstructions());
      },
      summarize: (jid) => {
        const { chat, messages } = chatOrThrow(jid);
        if (provider() === "local") return localAi.summarize(chat.name, messages);
        return deepseek.summarize(requireDeepseekKey(), chat.name, messages);
      },
      setProvider: (p) => {
        store.setSetting("ai_provider", p);
        broadcast("ai", aiState());
      },
      select: async (id) => {
        await localAi.select(id);
        store.setSetting("ai_model", id);
      },
      setInstructions: (text) => {
        store.setSetting("ai_instructions", text?.trim() ? text.trim() : null);
        broadcast("ai", aiState());
      },
    },
    media: async (jid, id) => {
      const ref = store.getMediaRef(jid, id);
      if (!ref) throw new Error("Esta mensagem não tem mídia salva. Mídias recebidas antes desta versão não podem ser abertas.");
      return loadMedia(join(options.dataDir, "media"), jid, id, ref);
    },
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
    prefs: () => readPrefs(store),
    close: async () => {
      clearInterval(heartbeat);
      await localAi.close();
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
