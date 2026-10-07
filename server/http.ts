import { readFile, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { z } from "zod";
import { claudeOptionsSchema, type ClaudeOptions } from "./claude.ts";
import { deepseekOptionsSchema, type DeepSeekOptions } from "./deepseek.ts";
import { STATUSES, type Store } from "./db.ts";
import { prefsSchema, type Prefs } from "./prefs.ts";

export type Api = {
  store: Store;
  distDir: string;
  port: number;
  state: () => unknown;
  send: (jid: string, text: string, opts: { quotedId?: string; mentions?: string[]; mentionAll?: boolean }) => Promise<void>;
  sendMedia: (jid: string, file: { body: Buffer; mimetype: string; fileName: string; caption?: string; ptt?: boolean; seconds?: number }, quotedId?: string) => Promise<void>;
  /** everyone = apagar para todos; me = só deste lado. synced = o celular também apagou. */
  deleteMessage: (jid: string, id: string, mode: "everyone" | "me") => Promise<{ synced: boolean }>;
  participants: (jid: string) => Promise<unknown>;
  profile: (jid: string) => Promise<unknown>;
  /** Foto de perfil (miniatura em cache ou tamanho cheio); null = sem foto. */
  photo: (jid: string, full: boolean) => Promise<Buffer | null>;
  /** Emoji vazio tira a reação. */
  react: (jid: string, id: string, emoji: string) => Promise<void>;
  editMessage: (jid: string, id: string, text: string) => Promise<void>;
  forward: (from: string, id: string, to: string) => Promise<void>;
  /** Conversa aberta na tela: assina o "digitando" do contato. */
  watch: (jid: string) => Promise<void>;
  typing: (jid: string, state: "composing" | "paused") => Promise<void>;
  markRead: (jid: string) => Promise<void>;
  classify: (jid: string) => Promise<unknown>;
  saveSettings: (s: { jevApiKey?: string | null; deepseekApiKey?: string | null; groqApiKey?: string | null; autoTranscribe?: boolean; autoClassify?: boolean; classifyProvider?: "jev" | "deepseek"; prefs?: Partial<Prefs> }) => void;
  logout: () => Promise<void>;
  /** Apaga as conversas deste computador; com reconnect, desconecta para ler o QR de novo. */
  reset: (reconnect: boolean) => Promise<void>;
  media: (jid: string, id: string) => Promise<{ body: Buffer; mimetype: string; fileName: string | null }>;
  transcribe: (jid: string, id: string) => Promise<string>;
  transcribeRecording: (body: Buffer, mimetype: string) => Promise<string>;
  /** Só o cache: não chama a Groq. */
  cachedTranscript: (jid: string, id: string) => Promise<string | null>;
  ai: {
    status: () => unknown;
    draft: (jid: string) => Promise<string>;
    summarize: (jid: string) => Promise<unknown>;
    setInstructions: (text: string | null) => void;
    setProvider: (provider: "deepseek" | "claude") => void;
    setDeepseekModel: (model: "deepseek-v4-pro" | "deepseek-flash") => void;
    setClaudeModel: (model: "sonnet" | "opus" | "fable" | "haiku") => void;
    setClaudeOptions: (options: ClaudeOptions | null) => void;
    setJevContext: (n: number | null) => void;
    /** null volta tudo ao padrão. */
    setDeepseekOptions: (options: DeepSeekOptions | null) => void;
    /** Resumo de gastos; days = null: desde sempre. */
    usage: (days: number | null) => unknown;
    setUsdBrl: (rate: number | null) => void;
  };
  /** Caminho de uma cópia consistente do banco, para download. */
  backup: () => Promise<string>;
  subscribe: (res: ServerResponse) => void;
  onChatChanged: (jid: string) => void;
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

const labelsSchema = z
  .array(z.object({ name: z.string().trim().min(1).max(40), description: z.string().trim().max(300) }))
  .min(2, "Cadastre pelo menos duas etiquetas.")
  .max(30)
  .refine((l) => new Set(l.map((x) => x.name.toLowerCase())).size === l.length, "Há etiquetas com o mesmo nome.");

const chatPatchSchema = z.object({
  status: z.enum(STATUSES).optional(),
  label: z.string().min(1).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  extraLabels: z.array(z.string().min(1).max(30)).max(20).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  mutedUntil: z.number().int().positive().nullable().optional(),
  snoozedUntil: z.number().int().positive().nullable().optional(),
  autoTranscribe: z.enum(["on", "off"]).nullable().optional(),
});

const reminderSchema = z.object({
  dueAt: z.number().int().positive(),
  text: z.string().trim().max(300).default(""),
});

const quickRepliesSchema = z
  .array(
    z.object({
      shortcut: z.string().trim().regex(/^[a-z0-9-]{1,30}$/, "Atalho: só letras minúsculas, números e hífen, sem espaço."),
      text: z.string().trim().min(1, "Toda resposta rápida precisa de texto.").max(4096),
    }),
  )
  .max(100)
  .refine((l) => new Set(l.map((x) => x.shortcut)).size === l.length, "Há respostas rápidas com o mesmo atalho.");

const settingsSchema = z.object({
  prefs: prefsSchema.partial().optional(),
  jevApiKey: z.string().trim().min(10).max(500).nullable().optional(),
  deepseekApiKey: z.string().trim().min(10).max(500).nullable().optional(),
  groqApiKey: z.string().trim().min(10).max(500).nullable().optional(),
  autoTranscribe: z.boolean().optional(),
  autoClassify: z.boolean().optional(),
  classifyProvider: z.enum(["jev", "deepseek"]).optional(),
});

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Limite de anexo enviado pelo app (o JSON leva base64, ~33% maior). */
const MAX_MEDIA = 32 * 1024 * 1024;
const sendMediaSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimetype: z.string().trim().min(1).max(128),
  data: z.string().min(1),
  caption: z.string().max(4096).optional(),
  ptt: z.boolean().optional(),
  seconds: z.number().positive().max(24 * 3600).optional(),
  quotedId: z.string().min(1).max(200).optional(),
});

const sendSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  quotedId: z.string().min(1).max(200).optional(),
  mentions: z.array(z.string().regex(/^[\w.:-]+@(s\.whatsapp\.net|lid)$/, "Menção inválida.")).max(256).optional(),
  /** "@todos": menciona o grupo inteiro. */
  mentionAll: z.boolean().optional(),
});

/** JID de conversa, contato ou participante na URL. */
const JID = /^[\w.:-]+@(s\.whatsapp\.net|lid|g\.us)$/;

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Conteúdo grande demais.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Dados inválidos.");
  return r.data;
}

/**
 * O app só escuta em 127.0.0.1, mas um site aberto no navegador ainda pode tentar falar
 * com ele (CSRF / DNS rebinding). Exige Host local e, em escrita, Origin local + JSON.
 */
function guard(req: IncomingMessage, port: number) {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowed.includes(req.headers.host ?? "")) throw new HttpError(403, "Host não permitido.");
  if (req.method === "GET") return;
  const origin = req.headers.origin;
  if (origin && !allowed.some((h) => origin === `http://${h}`)) throw new HttpError(403, "Origem não permitida.");
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "Use application/json.");
  }
}

/** Arquivo da interface em memória; a chave (tamanho + mtime) detecta rebuild em desenvolvimento. */
type StaticFile = { key: string; etag: string; body: Buffer };
const staticCache = new Map<string, StaticFile>();

async function readStatic(file: string): Promise<StaticFile> {
  const info = await stat(file);
  const key = `${info.size}-${info.mtimeMs}`;
  const cached = staticCache.get(file);
  if (cached?.key === key) return cached;
  const entry: StaticFile = { key, etag: `"${key}"`, body: await readFile(file) };
  staticCache.set(file, entry);
  return entry;
}

export function createHandler(api: Api) {
  const { store } = api;

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const chatMatch = path.match(/^\/api\/chats\/([^/]+)(\/[a-z-]+)?$/);
    const jid = chatMatch ? decodeURIComponent(chatMatch[1]) : null;
    const action = chatMatch?.[2] ?? "";

    if (path === "/api/events" && method === "GET") return api.subscribe(res);
    if (path === "/api/state" && method === "GET") return json(res, 200, api.state());
    if (path === "/api/chats" && method === "GET") return json(res, 200, store.listChats());
    if (path === "/api/search" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").slice(0, 200);
      return json(res, 200, store.search(q));
    }

    if (jid) {
      if (!store.hasChat(jid)) throw new HttpError(404, "Conversa não encontrada.");
      if (action === "" && method === "PATCH") {
        const patch = parse(chatPatchSchema, await readJson(req));
        const known = new Set(store.listLabels().map((l) => l.name));
        if (patch.label && !known.has(patch.label)) throw new HttpError(400, "Etiqueta não cadastrada.");
        if (patch.extraLabels?.some((l) => !known.has(l))) throw new HttpError(400, "Etiqueta não cadastrada.");
        if (patch.snoozedUntil && patch.snoozedUntil <= Date.now()) throw new HttpError(400, "Escolha um horário no futuro para adiar.");
        store.updateChat(jid, patch);
        if (patch.note !== undefined) store.setNote(jid, patch.note);
        api.onChatChanged(jid);
        return json(res, 200, store.getChat(jid));
      }
      if (action === "/messages" && method === "GET") {
        const around = url.searchParams.get("around");
        if (around) {
          const list = store.listMessagesAround(jid, around);
          if (!list) throw new HttpError(404, "Mensagem não encontrada.");
          return json(res, 200, list);
        }
        const before = Number(url.searchParams.get("before")) || null;
        return json(res, 200, store.listMessages(jid, before));
      }
      if (action === "/read" && method === "POST") {
        await api.markRead(jid);
        return json(res, 200, store.getChat(jid));
      }
      if (action === "/send-media" && method === "POST") {
        const { data, quotedId, ...file } = parse(sendMediaSchema, await readJson(req, Math.ceil((MAX_MEDIA * 4) / 3) + 64 * 1024));
        const body = Buffer.from(data, "base64");
        if (!body.length) throw new HttpError(400, "Arquivo vazio.");
        if (body.length > MAX_MEDIA) throw new HttpError(413, "Arquivo maior que 32 MB.");
        await api.sendMedia(jid, { ...file, body }, quotedId);
        return json(res, 200, store.getChat(jid));
      }
      if (action === "/send" && method === "POST") {
        const { text, quotedId, mentions, mentionAll } = parse(sendSchema, await readJson(req));
        if (quotedId && !store.messageKey(jid, quotedId)) throw new HttpError(404, "A mensagem respondida não está mais salva.");
        await api.send(jid, text, { quotedId, mentions, mentionAll });
        return json(res, 200, store.getChat(jid));
      }
      if (action === "/delete" && method === "POST") {
        const { id, mode } = parse(z.object({ id: z.string().min(1).max(200), mode: z.enum(["everyone", "me"]) }), await readJson(req));
        if (!store.messageKey(jid, id)) throw new HttpError(404, "Mensagem não encontrada.");
        const { synced } = await api.deleteMessage(jid, id, mode);
        return json(res, 200, { chat: store.getChat(jid), synced });
      }
      if (action === "/participants" && method === "GET") return json(res, 200, await api.participants(jid));
      if (action === "/edit" && method === "POST") {
        const { id, text } = parse(z.object({ id: z.string().min(1).max(200), text: z.string().trim().min(1).max(4096) }), await readJson(req));
        await api.editMessage(jid, id, text);
        return json(res, 200, store.getMessage(jid, id));
      }
      if (action === "/forward" && method === "POST") {
        const { id, to } = parse(z.object({ id: z.string().min(1).max(200), to: z.string().min(1).max(200) }), await readJson(req));
        if (!store.hasChat(to)) throw new HttpError(404, "Conversa de destino não encontrada.");
        if (!store.getMessage(jid, id)) throw new HttpError(404, "Mensagem não encontrada.");
        await api.forward(jid, id, to);
        return json(res, 200, store.getChat(to));
      }
      if (action === "/watch" && method === "POST") {
        await api.watch(jid);
        return json(res, 200, { ok: true });
      }
      if (action === "/typing" && method === "POST") {
        const { state } = parse(z.object({ state: z.enum(["composing", "paused"]) }), await readJson(req));
        await api.typing(jid, state);
        return json(res, 200, { ok: true });
      }
      if (action === "/react" && method === "POST") {
        const { id, emoji } = parse(z.object({ id: z.string().min(1).max(200), emoji: z.string().max(16) }), await readJson(req));
        await api.react(jid, id, emoji);
        return json(res, 200, store.getMessage(jid, id));
      }
      if (action === "/reminders" && method === "GET") return json(res, 200, store.listReminders(jid));
      if (action === "/reminders" && method === "POST") {
        const body = parse(reminderSchema, await readJson(req));
        const reminder = store.addReminder(jid, body.dueAt, body.text);
        api.onChatChanged(jid);
        return json(res, 201, reminder);
      }
      if (action === "/draft" && method === "POST") {
        await readJson(req);
        return json(res, 200, { text: await api.ai.draft(jid) });
      }
      if (action === "/summary" && method === "POST") {
        await readJson(req);
        return json(res, 200, await api.ai.summarize(jid));
      }
      if (action === "/classify" && method === "POST") {
        await readJson(req);
        return json(res, 200, await api.classify(jid));
      }
    }

    const profileMatch = path.match(/^\/api\/(profile|photo)\/([^/]+)$/);
    if (profileMatch && method === "GET") {
      const target = decodeURIComponent(profileMatch[2]);
      if (!JID.test(target)) throw new HttpError(400, "Contato inválido.");
      if (profileMatch[1] === "profile") return json(res, 200, await api.profile(target));
      const body = await api.photo(target, url.searchParams.has("full"));
      if (!body) {
        // Sem foto: a tela mostra as iniciais. Cache curto para não perguntar a cada rolagem.
        res.writeHead(404, { "cache-control": "private, max-age=3600" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "content-length": body.length });
      return res.end(body);
    }
    if (path === "/api/ai" && method === "GET") return json(res, 200, api.ai.status());
    if (path === "/api/ai/usage" && method === "GET") {
      const days = url.searchParams.get("days");
      return json(res, 200, api.ai.usage(days === null || days === "all" ? null : Math.max(1, Math.min(3650, Number(days) || 30))));
    }
    if (path === "/api/ai/usage/rate" && method === "PUT") {
      const { rate } = parse(z.object({ rate: z.number().positive().max(100).nullable() }), await readJson(req));
      api.ai.setUsdBrl(rate);
      return json(res, 200, { ok: true });
    }
    if (path === "/api/ai/provider" && method === "PUT") {
      const { provider } = parse(z.object({ provider: z.enum(["deepseek", "claude"]) }), await readJson(req));
      api.ai.setProvider(provider);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/deepseek-model" && method === "PUT") {
      const { model } = parse(z.object({ model: z.enum(["deepseek-v4-pro", "deepseek-flash"]) }), await readJson(req));
      api.ai.setDeepseekModel(model);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/claude-model" && method === "PUT") {
      const { model } = parse(z.object({ model: z.enum(["sonnet", "opus", "fable", "haiku"]) }), await readJson(req));
      api.ai.setClaudeModel(model);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/claude-options" && method === "PUT") {
      const { options } = parse(z.object({ options: claudeOptionsSchema.nullable() }), await readJson(req));
      api.ai.setClaudeOptions(options);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/jev-context" && method === "PUT") {
      const { messages } = parse(z.object({ messages: z.number().int().min(10).max(100).nullable() }), await readJson(req));
      api.ai.setJevContext(messages);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/deepseek-options" && method === "PUT") {
      const { options } = parse(z.object({ options: deepseekOptionsSchema.nullable() }), await readJson(req));
      api.ai.setDeepseekOptions(options);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/instructions" && method === "PUT") {
      const { text } = parse(z.object({ text: z.string().max(2000).nullable() }), await readJson(req));
      api.ai.setInstructions(text);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/transcribe-recording" && method === "POST") {
      const { data, mimetype } = parse(
        z.object({ data: z.string().min(1), mimetype: z.enum(["audio/webm", "audio/ogg"]) }),
        await readJson(req, Math.ceil((25 * 1024 * 1024 * 4) / 3) + 1024),
      );
      const text = await api.transcribeRecording(Buffer.from(data, "base64"), mimetype).catch((error: Error) => {
        throw new HttpError(502, error.message);
      });
      return json(res, 200, { text });
    }
    const transcribeMatch = path.match(/^\/api\/transcribe\/([^/]+)\/([^/]+)$/);
    if (transcribeMatch && method === "GET") {
      const text = await api.cachedTranscript(decodeURIComponent(transcribeMatch[1]), decodeURIComponent(transcribeMatch[2]));
      return json(res, 200, { text });
    }
    if (transcribeMatch && method === "POST") {
      await readJson(req);
      const text = await api.transcribe(decodeURIComponent(transcribeMatch[1]), decodeURIComponent(transcribeMatch[2])).catch((error: Error) => {
        throw new HttpError(502, error.message);
      });
      return json(res, 200, { text });
    }
    const mediaMatch = path.match(/^\/api\/media\/([^/]+)\/([^/]+)$/);
    if (mediaMatch && method === "GET") {
      const file = await api.media(decodeURIComponent(mediaMatch[1]), decodeURIComponent(mediaMatch[2])).catch((error: Error) => {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, `Não foi possível baixar a mídia. Ela pode ter expirado no WhatsApp. (${error.message})`);
      });
      // A mídia de uma mensagem nunca muda: o navegador pode guardar sem revalidar.
      const headers: Record<string, string> = { "content-type": file.mimetype, "cache-control": "private, max-age=31536000, immutable", "accept-ranges": "bytes" };
      if (url.searchParams.has("download")) {
        headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName ?? "arquivo")}`;
      }
      const size = file.body.length;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) {
          res.writeHead(416, { "content-range": `bytes */${size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) });
        return res.end(file.body.subarray(start, end + 1));
      }
      res.writeHead(200, { ...headers, "content-length": String(size) });
      return res.end(file.body);
    }
    const reminderMatch = path.match(/^\/api\/reminders\/(\d+)(\/done)?$/);
    if (reminderMatch && ((reminderMatch[2] && method === "POST") || (!reminderMatch[2] && method === "DELETE"))) {
      if (method === "POST") await readJson(req);
      const chatJid = store.finishReminder(Number(reminderMatch[1]), reminderMatch[2] ? "done" : "delete");
      if (!chatJid) throw new HttpError(404, "Lembrete não encontrado.");
      api.onChatChanged(chatJid);
      return json(res, 200, store.getChat(chatJid));
    }
    if (path === "/api/quick-replies" && method === "GET") return json(res, 200, store.listQuickReplies());
    if (path === "/api/quick-replies" && method === "PUT") {
      return json(res, 200, store.saveQuickReplies(parse(quickRepliesSchema, await readJson(req))));
    }
    if (path === "/api/labels" && method === "GET") return json(res, 200, store.listLabels());
    if (path === "/api/labels" && method === "PUT") {
      const labels = store.saveLabels(parse(labelsSchema, await readJson(req)));
      api.onChatChanged("*");
      return json(res, 200, labels);
    }
    if (path === "/api/settings" && method === "PUT") {
      api.saveSettings(parse(settingsSchema, await readJson(req)));
      return json(res, 200, api.state());
    }
    if (path === "/api/logout" && method === "POST") {
      await api.logout();
      return json(res, 200, api.state());
    }
    if (path === "/api/reset" && method === "POST") {
      const { reconnect } = parse(z.object({ reconnect: z.boolean() }), await readJson(req));
      await api.reset(reconnect);
      return json(res, 200, api.state());
    }
    if (path === "/api/backup" && method === "GET") {
      const file = await api.backup();
      try {
        const body = await readFile(file);
        const stamp = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          "content-type": "application/vnd.sqlite3",
          "content-disposition": `attachment; filename="whatsapp-inbox-backup-${stamp}.db"`,
          "cache-control": "no-store",
        });
        return res.end(body);
      } finally {
        await rm(file, { force: true });
      }
    }
    if (path.startsWith("/api/")) throw new HttpError(404, "Rota não encontrada.");

    // Arquivos da interface
    if (method !== "GET") throw new HttpError(405, "Método não permitido.");
    const file = normalize(join(api.distDir, path === "/" ? "index.html" : path));
    if (!file.startsWith(normalize(api.distDir))) throw new HttpError(403, "Caminho inválido.");
    let entry: StaticFile;
    try {
      entry = await readStatic(file);
    } catch {
      if (path === "/") throw new HttpError(503, "Interface não compilada. Rode pnpm build.");
      throw new HttpError(404, "Arquivo não encontrado.");
    }
    // Fontes e pedaços do bundle têm hash no nome: podem ficar em cache para sempre.
    // Os demais revalidam por ETag: o app.js só é baixado (e recompilado) de novo quando muda.
    const hashed = /^\/(assets|chunks)\//.test(path);
    const headers = {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      etag: entry.etag,
    };
    if (req.headers["if-none-match"] === entry.etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, "content-length": entry.body.length });
    res.end(entry.body);
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      guard(req, api.port);
      await route(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Erro inesperado.";
      if (status === 500) process.stderr.write(`[http] ${req.method} ${req.url}: ${message}\n`);
      if (!res.headersSent) json(res, status, { error: message });
      else res.end();
    }
  };
}
