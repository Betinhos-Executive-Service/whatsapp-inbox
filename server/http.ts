import { readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { z } from "zod";
import { STATUSES, type Store } from "./db.ts";
import { prefsSchema, type Prefs } from "./prefs.ts";

export type Api = {
  store: Store;
  distDir: string;
  port: number;
  state: () => unknown;
  send: (jid: string, text: string) => Promise<void>;
  markRead: (jid: string) => Promise<void>;
  classify: (jid: string) => Promise<unknown>;
  saveSettings: (s: { jevApiKey?: string | null; autoClassify?: boolean; prefs?: Partial<Prefs> }) => void;
  logout: () => Promise<void>;
  /** Apaga as conversas deste computador; com reconnect, desconecta para ler o QR de novo. */
  reset: (reconnect: boolean) => Promise<void>;
  media: (jid: string, id: string) => Promise<{ body: Buffer; mimetype: string; fileName: string | null }>;
  ai: {
    status: () => unknown;
    download: (id: "leve" | "melhor") => void;
    cancel: () => Promise<void>;
    remove: (id: "leve" | "melhor") => Promise<void>;
    draft: (jid: string) => Promise<string>;
    summarize: (jid: string) => Promise<unknown>;
    setInstructions: (text: string | null) => void;
    select: (id: "leve" | "melhor") => Promise<void>;
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
  autoClassify: z.boolean().optional(),
});

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, "Conteúdo grande demais.");
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

export function createHandler(api: Api) {
  const { store } = api;

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const chatMatch = path.match(/^\/api\/chats\/([^/]+)(\/[a-z]+)?$/);
    const jid = chatMatch ? decodeURIComponent(chatMatch[1]) : null;
    const action = chatMatch?.[2] ?? "";

    if (path === "/api/events" && method === "GET") return api.subscribe(res);
    if (path === "/api/state" && method === "GET") return json(res, 200, api.state());
    if (path === "/api/chats" && method === "GET") return json(res, 200, store.listChats());

    if (jid) {
      if (!store.getChat(jid)) throw new HttpError(404, "Conversa não encontrada.");
      if (action === "" && method === "PATCH") {
        const patch = parse(chatPatchSchema, await readJson(req));
        if (patch.label && !store.listLabels().some((l) => l.name === patch.label)) throw new HttpError(400, "Etiqueta não cadastrada.");
        store.updateChat(jid, patch);
        if (patch.note !== undefined) store.setNote(jid, patch.note);
        api.onChatChanged(jid);
        return json(res, 200, store.getChat(jid));
      }
      if (action === "/messages" && method === "GET") {
        const before = Number(url.searchParams.get("before")) || null;
        return json(res, 200, store.listMessages(jid, before));
      }
      if (action === "/read" && method === "POST") {
        await api.markRead(jid);
        return json(res, 200, store.getChat(jid));
      }
      if (action === "/send" && method === "POST") {
        const { text } = parse(z.object({ text: z.string().trim().min(1).max(4096) }), await readJson(req));
        await api.send(jid, text);
        return json(res, 200, store.getChat(jid));
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

    if (path === "/api/ai" && method === "GET") return json(res, 200, api.ai.status());
    const modelId = z.object({ id: z.enum(["leve", "melhor"]) });
    if (path === "/api/ai/download" && method === "POST") {
      api.ai.download(parse(modelId, await readJson(req)).id);
      return json(res, 202, api.ai.status());
    }
    if (path === "/api/ai/download/cancel" && method === "POST") {
      await readJson(req);
      await api.ai.cancel();
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/remove" && method === "POST") {
      await api.ai.remove(parse(modelId, await readJson(req)).id);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/model" && method === "PUT") {
      const { id } = parse(z.object({ id: z.enum(["leve", "melhor"]) }), await readJson(req));
      await api.ai.select(id);
      return json(res, 200, api.ai.status());
    }
    if (path === "/api/ai/instructions" && method === "PUT") {
      const { text } = parse(z.object({ text: z.string().max(2000).nullable() }), await readJson(req));
      api.ai.setInstructions(text);
      return json(res, 200, api.ai.status());
    }
    const mediaMatch = path.match(/^\/api\/media\/([^/]+)\/([^/]+)$/);
    if (mediaMatch && method === "GET") {
      const file = await api.media(decodeURIComponent(mediaMatch[1]), decodeURIComponent(mediaMatch[2])).catch((error: Error) => {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, `Não foi possível baixar a mídia. Ela pode ter expirado no WhatsApp. (${error.message})`);
      });
      const headers: Record<string, string> = { "content-type": file.mimetype, "cache-control": "private, max-age=86400" };
      if (url.searchParams.has("download")) {
        headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName ?? "arquivo")}`;
      }
      res.writeHead(200, headers);
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
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
      res.end(body);
    } catch {
      if (path === "/") throw new HttpError(503, "Interface não compilada. Rode pnpm build.");
      throw new HttpError(404, "Arquivo não encontrado.");
    }
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
