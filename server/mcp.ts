// Ferramentas MCP do WhatsApp Inbox para o Claude Code. Só leitura e organização; a resposta ao
// cliente vira um rascunho pendente que a pessoa envia, edita ou descarta na interface.
// Nunca escreve no stdout (é o canal do protocolo): erros voltam como `isError` ao Claude.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Chat, Message } from "./db.ts";
import type { InboxClient } from "./inbox-client.ts";
import { typeByExtension } from "./mime.ts";

// Só tipos de db.ts: importar valores puxaria o node:sqlite para o processo MCP.
const STATUSES = ["aberta", "aguardando", "resolvida"] as const satisfies readonly Chat["status"][];
/** Mesmo limite do envio pela interface. */
const MAX_MEDIA = 32 * 1024 * 1024;
const PROPOSED = "Rascunho proposto; a pessoa decide enviar no WhatsApp Inbox.";

type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (e: unknown): ToolResult => ({ content: [{ type: "text", text: `Erro: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
const guarded = <A>(fn: (args: A) => Promise<ToolResult>) => async (args: A): Promise<ToolResult> => fn(args).catch(fail);

const fmtDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const when = (ms: number) => fmtDate.format(new Date(ms)).replace(",", "");

function chatSummary(c: Chat) {
  return {
    jid: c.jid,
    nome: c.name,
    telefone: c.phone,
    grupo: c.isGroup,
    status: c.status,
    etiqueta: c.label,
    etiquetasExtras: c.extraLabels,
    naoLidas: c.unread + (c.markedUnread ? 1 : 0),
    ultimaMensagem: c.lastText,
    ultimaDeMim: c.lastFromMe,
    ultimaEm: c.lastAt ? new Date(c.lastAt).toISOString() : null,
    prioridadeIA: c.ai?.priority ?? null,
    nota: c.note,
    rascunhoPendente: c.pendingDraft ? { texto: c.pendingDraft.text, comAnexo: c.pendingDraft.hasMedia } : null,
  };
}

function mediaTag(m: Message): string {
  if (!m.media) return "";
  const dur = m.media.seconds ? ` ${Math.floor(m.media.seconds / 60)}:${String(Math.round(m.media.seconds % 60)).padStart(2, "0")}` : "";
  return ` {${m.media.type}${dur}${m.media.fileName ? ` ${m.media.fileName}` : ""}}`;
}

function formatMessage(m: Message, chat: Chat | null): string {
  const author = m.fromMe ? "Eu" : chat?.isGroup && m.sender ? m.sender.split("@")[0] : (chat?.name ?? "Contato");
  const quoted = m.quoted ? ` (respondendo: "${m.quoted.text.slice(0, 60)}")` : "";
  return `[${when(m.at)}] ${author}: ${m.deleted ? "(apagada)" : m.text}${mediaTag(m)}${quoted}  #${m.id}`;
}

export function createMcpServer(client: InboxClient): McpServer {
  const server = new McpServer({ name: "whatsapp-inbox", version: "1.0.0" });

  server.registerTool(
    "listar_conversas",
    {
      title: "Listar conversas",
      description: "Lista conversas do WhatsApp Inbox, da mais recente para a mais antiga. Filtra por status (aberta, aguardando, resolvida), etiqueta ou só não lidas.",
      inputSchema: {
        status: z.enum(STATUSES).optional().describe("Só conversas neste status."),
        etiqueta: z.string().optional().describe("Só conversas com esta etiqueta (principal ou extra)."),
        soNaoLidas: z.boolean().optional().describe("Só conversas com mensagem não lida."),
        limite: z.number().int().min(1).max(200).default(30),
      },
    },
    guarded(async ({ status, etiqueta, soNaoLidas, limite }) => {
      let chats = await client.chats();
      if (status) chats = chats.filter((c) => c.status === status);
      if (etiqueta) chats = chats.filter((c) => c.label === etiqueta || c.extraLabels.includes(etiqueta));
      if (soNaoLidas) chats = chats.filter((c) => c.unread > 0 || c.markedUnread);
      return text(JSON.stringify(chats.slice(0, limite).map(chatSummary)));
    }),
  );

  server.registerTool(
    "ler_mensagens",
    {
      title: "Ler mensagens",
      description: "Mensagens de uma conversa em ordem cronológica. Cada linha termina com #id, usado para citar em propor_resposta ou abrir mídia em ler_midia.",
      inputSchema: {
        jid: z.string().describe("JID da conversa (de listar_conversas)."),
        antes: z.number().int().positive().optional().describe("Só mensagens anteriores a este instante (ms desde 1970), para paginar."),
        limite: z.number().int().min(1).max(500).default(80),
      },
    },
    guarded(async ({ jid, antes, limite }) => {
      const [chat, messages] = await Promise.all([client.chat(jid), client.messages(jid, antes, limite)]);
      if (!messages.length) return text("Sem mensagens.");
      const header = chat ? `${chat.name}${chat.phone ? ` (+${chat.phone})` : ""} · status ${chat.status}${chat.label ? ` · etiqueta ${chat.label}` : ""}\n` : "";
      return text(header + messages.map((m) => formatMessage(m, chat)).join("\n"));
    }),
  );

  server.registerTool(
    "buscar_mensagens",
    {
      title: "Buscar mensagens",
      description: "Busca um texto em todas as conversas. O trecho encontrado vem entre **.",
      inputSchema: { texto: z.string().min(1).max(200) },
    },
    guarded(async ({ texto }) => {
      const [hits, chats] = await Promise.all([client.search(texto), client.chats()]);
      if (!hits.length) return text("Nada encontrado.");
      const names = new Map(chats.map((c) => [c.jid, c.name]));
      return text(hits.map((h) => `[${when(h.at)}] ${names.get(h.chatJid) ?? h.chatJid} (${h.chatJid}) ${h.fromMe ? "eu" : "contato"}: ${h.snippet.replace(/\u0002|\u0003/g, "**")}  #${h.id}`).join("\n"));
    }),
  );

  server.registerTool(
    "ler_midia",
    {
      title: "Ler mídia",
      description: "Abre a mídia de uma mensagem: áudio vira transcrição (usa a transcrição salva; sem ela, transcreve agora pelo Groq, com custo), imagem vem como imagem, os demais são salvos em uma pasta temporária e devolvem o caminho.",
      inputSchema: { jid: z.string(), id: z.string().describe("id da mensagem (o #id de ler_mensagens).") },
    },
    guarded(async ({ jid, id }) => {
      const file = await client.media(jid, id);
      if (file.mimetype.startsWith("audio/")) {
        const cached = await client.cachedTranscript(jid, id).catch(() => ({ text: null }));
        const t = cached.text ?? (await client.transcribe(jid, id)).text;
        return text(`Transcrição do áudio: ${t}`);
      }
      if (file.mimetype.startsWith("image/")) {
        return { content: [{ type: "image", data: file.body.toString("base64"), mimeType: file.mimetype }] };
      }
      const dir = join(tmpdir(), "whatsapp-inbox-mcp", id.replace(/[^\w.-]/g, "_"));
      await mkdir(dir, { recursive: true });
      const path = join(dir, basename(file.fileName ?? "arquivo").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_"));
      await writeFile(path, file.body);
      return text(`Arquivo salvo em ${path} (${file.mimetype}, ${file.body.length} bytes).`);
    }),
  );

  server.registerTool(
    "listar_etiquetas",
    { title: "Listar etiquetas", description: "Etiquetas disponíveis para classificar conversas, com descrição.", inputSchema: {} },
    guarded(async () => text(JSON.stringify(await client.labels()))),
  );

  server.registerTool(
    "perfil_contato",
    { title: "Perfil do contato", description: "Dados da conversa (nome, telefone, nota interna, status) e o perfil no WhatsApp (recado, participantes de grupo).", inputSchema: { jid: z.string() } },
    guarded(async ({ jid }) => {
      const [chat, profile] = await Promise.all([client.chat(jid), client.profile(jid).catch((e: Error) => ({ erro: e.message }))]);
      return text(JSON.stringify({ conversa: chat ? chatSummary(chat) : null, perfil: profile }));
    }),
  );

  server.registerTool(
    "marcar_lida",
    { title: "Marcar como lida", description: "Marca a conversa como lida (também manda o recibo de leitura ao WhatsApp).", inputSchema: { jid: z.string() } },
    guarded(async ({ jid }) => {
      await client.read(jid);
      return text("Conversa marcada como lida.");
    }),
  );

  server.registerTool(
    "atualizar_conversa",
    {
      title: "Atualizar conversa",
      description: "Muda status, etiqueta principal ou nota interna da conversa. Etiqueta precisa existir em listar_etiquetas; null remove.",
      inputSchema: {
        jid: z.string(),
        status: z.enum(STATUSES).optional(),
        etiqueta: z.string().nullable().optional(),
        nota: z.string().max(5000).nullable().optional(),
      },
    },
    guarded(async ({ jid, status, etiqueta, nota }) => {
      const patch: { status?: Chat["status"]; label?: string | null; note?: string | null } = {};
      if (status !== undefined) patch.status = status;
      if (etiqueta !== undefined) patch.label = etiqueta;
      if (nota !== undefined) patch.note = nota;
      if (!Object.keys(patch).length) return fail(new Error("Informe status, etiqueta ou nota."));
      const chat = await client.update(jid, patch);
      return text(JSON.stringify(chatSummary(chat)));
    }),
  );

  server.registerTool(
    "abrir_conversa",
    { title: "Abrir conversa", description: "Abre (ou acha) a conversa de um telefone com DDI, ex.: 5511999990000. Devolve o jid para as outras ferramentas.", inputSchema: { telefone: z.string().min(8).max(40) } },
    guarded(async ({ telefone }) => text(JSON.stringify(chatSummary(await client.openChat(telefone))))),
  );

  server.registerTool(
    "propor_resposta",
    {
      title: "Propor resposta",
      description: "Cria um rascunho de resposta na conversa. NÃO envia: a pessoa vê o rascunho no WhatsApp Inbox e decide enviar, editar ou descartar. Um rascunho novo substitui o anterior.",
      inputSchema: {
        jid: z.string(),
        texto: z.string().min(1).max(4096).describe("Texto pronto para o cliente, em pt-BR."),
        citarId: z.string().optional().describe("id da mensagem a responder (citação), opcional."),
      },
    },
    guarded(async ({ jid, texto, citarId }) => {
      await client.setPendingDraft(jid, { text: texto, quotedId: citarId, source: "claude" });
      return text(PROPOSED);
    }),
  );

  server.registerTool(
    "propor_midia",
    {
      title: "Propor mídia",
      description: "Cria um rascunho com um arquivo local (imagem, PDF, documento) e legenda opcional. NÃO envia: a pessoa confirma no WhatsApp Inbox. Limite de 32 MB.",
      inputSchema: {
        jid: z.string(),
        caminhoArquivo: z.string().min(1).describe("Caminho completo do arquivo neste computador."),
        legenda: z.string().max(4096).optional(),
      },
    },
    guarded(async ({ jid, caminhoArquivo, legenda }) => {
      const info = await stat(caminhoArquivo);
      if (!info.isFile()) throw new Error("O caminho não é um arquivo.");
      if (info.size > MAX_MEDIA) throw new Error("Arquivo maior que 32 MB.");
      const body = await readFile(caminhoArquivo);
      const fileName = basename(caminhoArquivo);
      await client.setPendingDraft(jid, { text: legenda ?? "", source: "claude", media: { fileName, mimetype: typeByExtension(fileName), data: body.toString("base64") } });
      return text(PROPOSED);
    }),
  );

  return server;
}
