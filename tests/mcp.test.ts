import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createInboxClient } from "../server/inbox-client.ts";
import { writeMcpFile } from "../server/mcp-file.ts";
import { createMcpServer } from "../server/mcp.ts";

const TOKEN = "b".repeat(64);
const PN = "5511999990000@s.whatsapp.net";
const chat = (over: Record<string, unknown> = {}) => ({
  jid: PN, name: "Ana", phone: "5511999990000", isGroup: false, lastAt: 1_700_000_000_000, lastText: "Tem carro?", lastFromMe: false, unread: 1,
  status: "aberta", label: "Cotação", labelSource: "manual", ai: { priority: "alta" }, aiError: null, note: null, reminderAt: null, aiUsage: { calls: 0, tokens: 0, costUsd: 0 },
  extraLabels: [], pinnedAt: null, archived: false, mutedUntil: null, snoozedUntil: null, autoTranscribe: null, markedUnread: false, ephemeral: null, pins: [], pendingDraft: null, ...over,
});

type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };

/** Servidor MCP ligado a um `fetch` de mentira que registra as chamadas e responde fixtures. */
async function setup(routes: (call: Call) => Response | null, withFile = true) {
  const dir = mkdtempSync(join(tmpdir(), "wi-mcp-test-"));
  const file = join(dir, "mcp.json");
  if (withFile) writeMcpFile(file, { port: 4321, token: TOKEN, account: "t", pid: 1 });
  const calls: Call[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.host, "127.0.0.1:4321");
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const call: Call = { method: init?.method ?? "GET", path: url.pathname + url.search, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return routes(call) ?? Response.json({ error: "rota não prevista" }, { status: 404 });
  };
  const server = createMcpServer(createInboxClient({ fetch: fakeFetch, file }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "teste", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean };
    return r;
  };
  return { calls, call, close: () => Promise.all([client.close(), server.close()]) };
}

test("MCP: lista as ferramentas e manda o token em toda chamada", async () => {
  const { calls, call, close } = await setup(({ path }) => (path === "/api/chats" ? Response.json([chat(), chat({ jid: "x@s.whatsapp.net", status: "resolvida", unread: 0 })]) : null));
  try {
    const open = await call("listar_conversas", { status: "aberta" });
    assert.equal(open.isError, undefined);
    const list = JSON.parse(open.content[0].text!) as { jid: string; prioridadeIA: string; naoLidas: number }[];
    assert.equal(list.length, 1);
    assert.equal(list[0].jid, PN);
    assert.equal(list[0].prioridadeIA, "alta");
    assert.equal(calls[0].headers["x-inbox-token"], TOKEN);
    const unread = await call("listar_conversas", { soNaoLidas: true });
    assert.equal((JSON.parse(unread.content[0].text!) as unknown[]).length, 1);
  } finally {
    await close();
  }
});

test("MCP: propor_resposta cria rascunho pendente com citação; nunca chama /send", async () => {
  const { calls, call, close } = await setup(({ method, path }) => (method === "PUT" && path.endsWith("/pending-draft") ? Response.json(chat({ pendingDraft: { text: "Oi", hasMedia: false } })) : null));
  try {
    const r = await call("propor_resposta", { jid: PN, texto: "Sim, temos carro amanhã às 8h.", citarId: "m1" });
    assert.match(r.content[0].text!, /Rascunho proposto/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[0].path, `/api/chats/${encodeURIComponent(PN)}/pending-draft`);
    assert.deepEqual(calls[0].body, { text: "Sim, temos carro amanhã às 8h.", quotedId: "m1", source: "claude" });
    assert.equal(calls[0].headers["content-type"], "application/json");
  } finally {
    await close();
  }
});

test("MCP: ler_midia devolve imagem como imagem, áudio como transcrição", async () => {
  const { calls, call, close } = await setup(({ method, path }) => {
    if (path.startsWith("/api/media/") && path.includes("/img")) return new Response(Buffer.from("png!"), { headers: { "content-type": "image/png" } });
    if (path.startsWith("/api/media/") && path.includes("/aud")) return new Response(Buffer.from("ogg!"), { headers: { "content-type": "audio/ogg; codecs=opus" } });
    if (method === "GET" && path.startsWith("/api/transcribe/")) return Response.json({ text: null, summary: null });
    if (method === "POST" && path.startsWith("/api/transcribe/")) return Response.json({ text: "bom dia, tem carro?" });
    return null;
  });
  try {
    const img = await call("ler_midia", { jid: PN, id: "img" });
    assert.equal(img.content[0].type, "image");
    assert.equal(img.content[0].mimeType, "image/png");
    assert.equal(Buffer.from(img.content[0].data!, "base64").toString(), "png!");
    const aud = await call("ler_midia", { jid: PN, id: "aud" });
    assert.equal(aud.content[0].text, "Transcrição do áudio: bom dia, tem carro?");
    assert.ok(calls.some((c) => c.method === "POST" && c.path.startsWith("/api/transcribe/")));
  } finally {
    await close();
  }
});

test("MCP: sem o app aberto (sem mcp.json) cada ferramenta responde com erro claro", async () => {
  const { call, close } = await setup(() => null, false);
  try {
    const r = await call("listar_conversas");
    assert.equal(r.isError, true);
    assert.match(r.content[0].text!, /Abra o WhatsApp Inbox/);
  } finally {
    await close();
  }
});

test("MCP: propor_midia lê o arquivo local, deduz o tipo e recusa arquivo inexistente", async () => {
  const { calls, call, close } = await setup(({ method, path }) => (method === "PUT" && path.endsWith("/pending-draft") ? Response.json(chat()) : null));
  try {
    const dir = mkdtempSync(join(tmpdir(), "wi-mcp-file-"));
    const file = join(dir, "orcamento.pdf");
    writeFileSync(file, "%PDF-fake");
    const ok = await call("propor_midia", { jid: PN, caminhoArquivo: file, legenda: "Segue o orçamento" });
    assert.match(ok.content[0].text!, /Rascunho proposto/);
    const body = calls[0].body as { text: string; media: { fileName: string; mimetype: string; data: string } };
    assert.equal(body.text, "Segue o orçamento");
    assert.equal(body.media.fileName, "orcamento.pdf");
    assert.equal(body.media.mimetype, "application/pdf");
    assert.equal(Buffer.from(body.media.data, "base64").toString(), "%PDF-fake");
    const missing = await call("propor_midia", { jid: PN, caminhoArquivo: join(dir, "nao-existe.pdf") });
    assert.equal(missing.isError, true);
  } finally {
    await close();
  }
});

test("MCP: propor_voucher manda os dados ao app e recusa data inválida", async () => {
  const { calls, call, close } = await setup(({ method, path }) => (method === "POST" && path.endsWith("/voucher") ? Response.json(chat()) : null));
  try {
    const servicos = [{ os: "OS-1896", dataHoraSaida: "2026-10-09T08:30:00-03:00", trajeto: "Hotel / GRU" }];
    const ok = await call("propor_voucher", { jid: PN, legenda: "*Confirmação*", servicos, passageiros: ["Ana"], empresa: "ACME" });
    assert.equal(ok.isError, undefined);
    const body = calls.at(-1)!.body as { legenda: string; voucher: { servicos: unknown[]; empresa: string; email: string } };
    assert.equal(calls.at(-1)!.path, `/api/chats/${encodeURIComponent(PN)}/voucher`);
    assert.equal(body.legenda, "*Confirmação*");
    assert.deepEqual(body.voucher.servicos, servicos);
    assert.equal(body.voucher.empresa, "ACME");
    assert.equal(body.voucher.email, "");
    const bad = await call("propor_voucher", { jid: PN, legenda: "x", servicos: [{ os: "OS-1", dataHoraSaida: "amanhã" }] });
    assert.equal(bad.isError, true);
  } finally {
    await close();
  }
});
