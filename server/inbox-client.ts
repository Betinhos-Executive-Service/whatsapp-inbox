// Cliente da API HTTP local, usado pelo servidor MCP (outro processo). Não importa app.ts/db.ts:
// o Baileys e o SQLite ficam só dentro do app; aqui é só `fetch` com o token do mcp.json.
import { fileNameFromDisposition } from "./mime.ts";
import { readMcpFile } from "./mcp-file.ts";
import type { Chat, Label, Message, SearchHit, Status } from "./db.ts";

export const INBOX_UNAVAILABLE = "Abra o WhatsApp Inbox neste computador e tente de novo.";

export class InboxUnavailable extends Error {
  constructor() {
    super(INBOX_UNAVAILABLE);
  }
}

export type ChatPatchInput = { status?: Status; label?: string | null; note?: string | null };
export type PendingDraftInput = { text: string; quotedId?: string; source: string; media?: { fileName: string; mimetype: string; data: string } };
export type MediaFile = { body: Buffer; mimetype: string; fileName: string | null };

export type InboxClient = ReturnType<typeof createInboxClient>;

export function createInboxClient({ fetch: doFetch, file }: { fetch: typeof globalThis.fetch; file: string }) {
  const chatPath = (jid: string) => `/api/chats/${encodeURIComponent(jid)}`;

  // Relê o arquivo a cada chamada: o app pode ter reiniciado com porta e token novos.
  async function raw(method: string, path: string, body?: unknown): Promise<Response> {
    const info = readMcpFile(file);
    if (!info) throw new InboxUnavailable();
    let res: Response;
    try {
      res = await doFetch(`http://127.0.0.1:${info.port}${path}`, {
        method,
        headers: { "x-inbox-token": info.token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new InboxUnavailable();
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 403) throw new InboxUnavailable();
      throw new Error(data?.error ?? `Falha na comunicação com o app (${res.status}).`);
    }
    return res;
  }
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => (await raw(method, path, body)).json() as Promise<T>;

  return {
    chats: () => request<Chat[]>("GET", "/api/chats"),
    chat: async (jid: string): Promise<Chat | null> => (await request<Chat[]>("GET", "/api/chats")).find((c) => c.jid === jid) ?? null,
    messages: (jid: string, before?: number, limit?: number) => {
      const q = new URLSearchParams();
      if (before) q.set("before", String(before));
      if (limit) q.set("limit", String(limit));
      const qs = q.toString();
      return request<Message[]>("GET", `${chatPath(jid)}/messages${qs ? `?${qs}` : ""}`);
    },
    search: (text: string) => request<SearchHit[]>("GET", `/api/search?q=${encodeURIComponent(text)}`),
    media: async (jid: string, id: string): Promise<MediaFile> => {
      const res = await raw("GET", `/api/media/${encodeURIComponent(jid)}/${encodeURIComponent(id)}?download`);
      return {
        body: Buffer.from(await res.arrayBuffer()),
        mimetype: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim(),
        fileName: fileNameFromDisposition(res.headers.get("content-disposition")),
      };
    },
    cachedTranscript: (jid: string, id: string) => request<{ text: string | null }>("GET", `/api/transcribe/${encodeURIComponent(jid)}/${encodeURIComponent(id)}`),
    transcribe: (jid: string, id: string) => request<{ text: string }>("POST", `/api/transcribe/${encodeURIComponent(jid)}/${encodeURIComponent(id)}`, {}),
    labels: () => request<Label[]>("GET", "/api/labels"),
    profile: (jid: string) => request<Record<string, unknown>>("GET", `/api/profile/${encodeURIComponent(jid)}`),
    read: (jid: string) => request<Chat>("POST", `${chatPath(jid)}/read`, {}),
    update: (jid: string, patch: ChatPatchInput) => request<Chat>("PATCH", chatPath(jid), patch),
    openChat: (phone: string) => request<Chat>("POST", "/api/open-chat", { phone }),
    setPendingDraft: (jid: string, draft: PendingDraftInput) => request<Chat>("PUT", `${chatPath(jid)}/pending-draft`, draft),
    /** O app gera o PDF do voucher e o deixa como rascunho pendente, com a legenda. */
    proposeVoucher: (jid: string, body: { legenda: string; voucher: unknown }) => request<Chat>("POST", `${chatPath(jid)}/voucher`, body),
  };
}
