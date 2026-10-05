import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { Store, type Chat } from "./db.ts";
import { createHandler } from "./http.ts";
import type { Jev } from "./jev.ts";
import type { ConnectionState, WhatsApp } from "./whatsapp.ts";

const root = resolve(import.meta.dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { config: { port: number } };
const port = Number(process.env.PORT) || pkg.config.port;
const dataDir = resolve(root, process.env.DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });

const store = new Store(join(dataDir, "inbox.db"));
const disabled = process.env.WA_DISABLED === "1"; // só para testar a interface sem WhatsApp

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
setInterval(() => broadcast("ping", Date.now()), 25000).unref();

// ---- Jev

const jevKey = () => process.env.JEV_API_KEY || store.getSetting("jev_api_key");
const autoClassify = () => store.getSetting("auto_classify") !== "0";

let queue = Promise.resolve();
const pending = new Map<string, NodeJS.Timeout>();

function classify(jid: string): Promise<Chat | null> {
  const run = queue.then(async () => {
    const key = jevKey();
    if (!key) throw new Error("Configure a chave do Jev em Configurações.");
    const chat = store.getChat(jid);
    if (!chat) throw new Error("Conversa não encontrada.");
    try {
      const result = await (await getJev()).classify(key, chat.name, store.listMessages(jid, null, 30), store.listLabels());
      return store.saveClassification(jid, result);
    } catch (error) {
      const message = `Jev não classificou: ${error instanceof Error ? error.message : String(error)}`;
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
  if (!jevKey() || !autoClassify()) return;
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
  labels: store.listLabels(),
});

async function startWhatsApp() {
  const { WhatsApp } = await import("./whatsapp.ts");
  const client = new WhatsApp(store, join(dataDir, "auth"));
  client.on("connection", (s) => broadcast("connection", s));
  client.on("chat", (chat) => broadcast("chat", chat));
  client.on("reload", () => broadcast("reload", null));
  client.on("message", ({ message, chat, live }) => {
    broadcast("message", { message, chat });
    if (live && !message.fromMe) scheduleClassify(chat.jid);
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
  port,
  distDir: join(root, "dist"),
  state: publicState,
  send: (jid, text) => connected().send(jid, text),
  markRead: async (jid) => {
    const keys = store.markRead(jid);
    broadcast("chat", store.getChat(jid));
    await wa?.markRead(keys).catch(() => undefined); // recibo de leitura é cortesia, não bloqueia
  },
  classify,
  saveSettings: (s) => {
    if (s.jevApiKey !== undefined) store.setSetting("jev_api_key", s.jevApiKey);
    if (s.autoClassify !== undefined) store.setSetting("auto_classify", s.autoClassify ? "1" : "0");
    broadcast("state", publicState());
  },
  logout: () => connected().logout(),
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
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    process.stderr.write(`A porta ${port} já está em uso. O app já está aberto? Acesse http://127.0.0.1:${port}\n`);
    process.exit(1);
  }
  throw error;
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`WhatsApp Inbox em http://127.0.0.1:${port}\n`);
  if (!disabled) startWhatsApp().catch((e) => process.stderr.write(`[whatsapp] ${e instanceof Error ? e.message : e}\n`));
  if (jevKey()) void getJev();
});

async function shutdown() {
  await wa?.stop();
  for (const res of clients) res.end();
  server.close();
  store.db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
