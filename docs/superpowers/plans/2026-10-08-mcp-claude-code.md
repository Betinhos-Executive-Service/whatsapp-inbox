# Plano — Servidor MCP do WhatsApp Inbox para o Claude Code

## Contexto

O Inbox já chama o Claude Code local (`claude -p`, `server/claude.ts`) só para rascunho/resumo, com leitura do Dataverse. Renan quer o inverso: qualquer sessão do Claude Code neste PC enxergar as conversas do WhatsApp, agendar no Dataverse (já possível pelos MCPs do Claude) e **propor** a resposta ao cliente. Decisões aprovadas no brainstorming:

- Transporte **stdio**, só este PC, só a **conta ativa**.
- Envio **nunca direto**: o MCP cria um *rascunho pendente*; a pessoa confirma no Inbox (Enviar / Editar / Descartar).
- Escopo v1: ler conversas/mensagens/busca/mídia (áudio → transcrição, imagem → conteúdo de imagem, outros → caminho em temp), marcar lida, atualizar status/etiqueta/nota, abrir conversa, propor texto e propor mídia.
- Registro no Claude Code por botão em Configurações › IA.
- Abordagem A: processo stdio separado (`server/mcp-main.ts`) que fala com a API HTTP local via `fetch` + token; Baileys continua só no app.

Fora de escopo: envio direto, multi-conta, push do Inbox para o Claude, config do Claude Desktop.

Achados que moldam o design: o desktop sobe em **porta aleatória** (`desktop/main.ts:181`, `port: 0`) e a API local não tem token (`guard()` em `server/http.ts:278` só checa Host/Origin); rascunhos hoje só existem na memória da UI (`drafts` em `ui/organize.tsx`).

## Restrições globais

- Ler integralmente `C:\Users\mendo\Desktop\vscode\DESIGN_SYSTEM.md` antes das tarefas de UI (8 e 9): tema claro, sem gradiente, neutros `#FCFCFB`, tokens `--bt-*` de `ui/design-tokens.css`, componentes de `ui/ds/index.ts`. Respostas sobre UI começam com `DESIGN CONTEXTO`.
- Não editar `version` à mão (`bumpVersion()` em `scripts/ui-build.mjs`); não tocar em `__APP_VERSION__`/`__BUILD_DATE__`.
- `server/mcp*.ts` e `server/inbox-client.ts` **não** importam `app.ts`/`db.ts`/`http.ts` (stdout é o protocolo; `app.ts` redefine `console.*`). Logs só em `stderr`.
- Rotas seguem o padrão de `createHandler` (`server/http.ts:303+`): `if (path === … && method === …)`, `parse(schema, await readJson(req))`, `json(res, …)`, `HttpError`.
- Token só em header `x-inbox-token` e no `mcp.json`; nunca em argv/URL.
- Ao fim de cada tarefa: `pnpm typecheck` e `pnpm test` verdes. Commits em português, detalhados.

## Tarefas

### 0. Preparação
- Gravar o design aprovado em `docs/superpowers/specs/2026-10-08-mcp-claude-code-design.md` e este plano em `docs/superpowers/plans/2026-10-08-mcp-claude-code.md` (formato de `2026-10-07-windows-notifications.md`).
- `pnpm add -D @modelcontextprotocol/sdk` (devDependency: o SDK é empacotado em `dist-electron/mcp.mjs`). Confirmar que a versão aceita zod 4 (`zod/v4`); se não, fixar versão compatível.

### 1. Rascunho pendente no Store (`server/db.ts`)
- Tabela `drafts(chat_jid PK references chats(jid) on delete cascade on update cascade, text, quoted_id, media_body blob, media_mime, media_name, source default 'claude', created_at)` no `SCHEMA` (~184-297).
- `Chat` ganha `pendingDraft: { text; hasMedia; source; createdAt } | null`; `CHAT_SELECT` (~338) com subselect `json_object(...)`, `toChat` (~355) faz parse. Assim `listChats`/`getChat`/`updateChat` já devolvem o campo.
- Métodos: `setPendingDraft(jid, {text, quotedId?, media?, source})` (upsert), `getPendingDraft(jid)` (BLOB `Uint8Array` → `Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)`, padrão de `rawMessage` ~1018), `clearPendingDraft(jid): boolean`.
- Conferir `clearConversations`: cascata ou `delete from drafts`.
- Teste `tests/drafts.test.ts` (padrão `tests/core.test.ts`, `new Store(":memory:")`, `msg()`): set/get/clear, mídia ida e volta, substituição, cascata.

### 2. Token e `guard()` (`server/app.ts`, `server/http.ts`)
- `startApp` gera `randomBytes(32).toString("hex")`; `RunningApp` (~53-64) e `Api` (~49-128) ganham `token`.
- `guard(req, port, token)`: Host local sempre; se header `x-inbox-token` presente → deve bater (`timingSafeEqual` após checar tamanho), senão 403 mesmo em GET; batendo, pula Origin mas mantém `content-type: application/json` em escrita; sem header → comportamento atual.
- Atualizar fake `Api` em `tests/core.test.ts` (~179-230) com `token` (e `mcp` na tarefa 6). Recomendado extrair `tests/fake-api.ts` com `fakeApi(store, overrides)`.
- Testes: token certo sem Origin → 200; token errado → 403 (GET e POST); token certo + `text/plain` → 415; Host estranho → 403; `close.test.ts`: `token` casa `/^[0-9a-f]{64}$/`.

### 3. Rotas do rascunho (`server/http.ts`, `ui/api.ts`)
- No bloco `if (jid)` (~335-504; `chatMatch` já casa `/pending-draft`):
  - `PUT /api/chats/:jid/pending-draft` — schema `{ text max 4096 default "", quotedId?, source default "claude", media?: {fileName, mimetype, data base64} }` reusando limites de `sendMediaSchema` (~231) e o limite grande de `readJson` do `/send-media` (~369). 400 se texto vazio sem mídia; 404 se `quotedId` sem `store.messageKey`. Depois `api.onChatChanged(jid)` (dispara `broadcast("chat")`), 200 com `store.getChat(jid)`.
  - `GET …/pending-draft` → 404 ou `{ text, quotedId, quoted, media: {mimetype, fileName} | null, source, createdAt }` (sem corpo).
  - `DELETE …/pending-draft` → clear + `onChatChanged`.
  - Match próprio `^/api/chats/([^/]+)/pending-draft/(media|send)$` antes do bloco `if (jid)`: `GET …/media` serve o BLOB como `/api/media` (`servedType`, `nosniff`, `cache-control: no-store`); `POST …/send` → com mídia `api.sendMedia(jid, {body, mimetype, fileName, caption: text || undefined}, quotedId)`, senão `api.send(jid, text, {quotedId})`; só limpa se o envio deu certo.
  - `GET …/messages` aceita `?limit=` (1..500, padrão 80).
- `ui/api.ts`: `Chat.pendingDraft`, `pendingDraft(jid)`, `sendPendingDraft(jid)`, `clearPendingDraft(jid)`, `pendingDraftMediaUrl(jid)`.
- Testes com fake `Api`: PUT/GET/DELETE/send/media, `onChatChanged` chamado, erros 400/404.

### 4. Arquivo de descoberta `mcp.json`
- `server/mcp-file.ts` (puro): `McpInfo = {port, token, account, pid}`; `writeMcpFile`, `removeMcpFile`, `readMcpFile` (zod: port inteiro, token hex 64, retorna `null` se ausente/inválido), `defaultMcpFile()` = `INBOX_MCP_FILE` ou `join(APPDATA ?? homedir(), "WhatsApp Inbox", "mcp.json")` (= `userData` do Electron).
- `desktop/main.ts` `startInstance` (~154-207): após `startApp`, se `isPrimary(inst)` grava; `closeAll` (~642) remove. `server/main.ts`: grava em `<dataDir>/mcp.json`, remove no `shutdown`, imprime o caminho.
- Teste `tests/mcp-file.test.ts`: write/read/remove em tmp, inválido → `null`, env respeitado.

### 5. Servidor MCP e cliente da API
- `server/mime.ts`: mover `TYPE_BY_EXT`/`EXT_BY_TYPE` de `http.ts:12-35` (http.ts importa de lá) e `fileNameFromDisposition` (`desktop/files.ts:21-31`).
- `server/inbox-client.ts`: `createInboxClient({ fetch, file })`; relê `mcp.json` a cada chamada; sem arquivo ou conexão recusada → `InboxUnavailable` com "Abra o WhatsApp Inbox neste computador e tente de novo."; outros erros repassam `data.error` (padrão de `request()` em `ui/api.ts:205`). Métodos: `chats`, `messages`, `search`, `media` (lê `content-type`/`content-disposition`), `cachedTranscript`, `transcribe`, `labels`, `profile`, `read`, `update`, `openChat`, `setPendingDraft`.
- `server/mcp.ts`: `createMcpServer(client)` com `registerTool` (pt-BR):
  - `listar_conversas(status?, etiqueta?, soNaoLidas?, limite? 1..200=30)` → JSON compacto (jid, nome, telefone, grupo, status, etiqueta, naoLidas, ultimaMensagem, ultimaEm ISO, prioridadeIA, rascunhoPendente).
  - `ler_mensagens(jid, antes?, limite? 1..500=80)` → linhas `[dd/mm hh:mm] Autor: texto` com `id` e marca de mídia.
  - `buscar_mensagens(texto)`; `ler_midia(jid, id)` (áudio → `cachedTranscript` senão `transcribe`; imagem → `{type:"image", data, mimeType}`; outros → `tmpdir()/whatsapp-inbox-mcp/<id>/<nome>`); `listar_etiquetas`; `perfil_contato(jid)`; `marcar_lida(jid)`; `atualizar_conversa(jid, status?, etiqueta?, nota?)`; `abrir_conversa(telefone)`.
  - `propor_resposta(jid, texto, citarId?)` → PUT pending-draft; `propor_midia(jid, caminhoArquivo, legenda?)` → `readFile`, mimetype por extensão, limite 32 MB, PUT com base64. Resposta: "Rascunho proposto; a pessoa decide enviar no WhatsApp Inbox."
  - Handlers em `try/catch` → `{ content: [{type:"text", text:"Erro: …"}], isError: true }`.
- `server/mcp-main.ts`: client + server + `StdioServerTransport`. Sem `console.log`.
- Teste `tests/mcp.test.ts`: `InMemoryTransport.createLinkedPair()` + `Client`; `fetch` falso registrando chamadas; casos: filtro de status + header token; `propor_resposta` faz PUT correto; `ler_midia` imagem/áudio; arquivo ausente → `isError`; `propor_midia` > 32 MB → erro.

### 6. Registro no Claude Code (`/api/mcp/*`)
- `AppOptions` (`app.ts:31-48`) ganha `mcpEntry?: { command, args, env }`: desktop = `process.execPath` + `dist-electron/mcp.mjs` + `{ ELECTRON_RUN_AS_NODE: "1", INBOX_MCP_FILE }`; dev = `process.execPath` + `server/mcp-main.ts` + `{ INBOX_MCP_FILE: <dataDir>/mcp.json }`.
- `server/mcp-register.ts` (puro): `MCP_NAME = "whatsapp-inbox"`, `addArgs(entry)` → `["mcp","add","--scope","user", ...["-e", "K=V"]..., MCP_NAME, "--", command, ...args]`, `removeArgs()`, `getArgs()`, `isRegistered(output, code)`, `displayCommand(entry)` (aspas em caminhos com espaço). Execução reusa `runClaude` (`server/claude.ts:69`) e `findClaudeBin` (~58), timeout 30 s; `claude mcp get` com código ≠ 0 = não registrado.
- `Api.mcp = { status, register, unregister }`; rotas `GET /api/mcp/status` (`{claudeFound, registered, command, file}`), `POST /api/mcp/register`, `POST /api/mcp/unregister` (erro do CLI → 502). Sem `mcpEntry` → `claudeFound:false`.
- `ui/api.ts`: `mcpStatus`, `mcpRegister`, `mcpUnregister`. Atualizar fakes.
- Teste `tests/mcp-register.test.ts`: `addArgs` exato, `displayCommand` com espaço, `isRegistered`.

### 7. Build do `mcp.mjs` (`scripts/desktop.mjs`)
- Após o build de `main` (~43-51): `esbuild.build({ entryPoints: ["server/mcp-main.ts"], outfile: "dist-electron/mcp.mjs", format: "esm", platform: "node", bundle: true, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })` — **sem** `packages: "external"` (SDK e zod no bundle; builtins de fora).
- `files` do `package.json` já inclui `dist-electron/**`. `scripts/dev.mjs` não muda.

### 8. UI — banner "Rascunho do Claude" (`ui/main.tsx`, `ui/app.css`)
- Componente `PendingDraftBar({ draft, busy, onSend, onEdit, onDiscard })` no composer antes de `{replyTo && <ReplyBar/>}` (~1977), quando `chat.pendingDraft` e não `editing`. Rótulo com ícone `Sparkles` 14 px, prévia 1-2 linhas (`WaInline`), "+ anexo" se `hasMedia`, hora relativa, `Button` do DS: **Enviar** (primário), **Editar**, **Descartar** (ghost).
- Ações em `ChatView`: Enviar → `api.sendPendingDraft` → `onChat(chat)` (bolha chega pelo SSE, como o envio de voz ~1290); Editar → `api.pendingDraft` → `setDraft(text)`, `setReplyTo(quoted)`, mídia via `fetch(pendingDraftMediaUrl)` → `File` → `addFiles([file])` (~977), depois `clearPendingDraft` e foco; Descartar → `clearPendingDraft`. Atualização vem do SSE `chat` → `upsert` (~2340).
- `ChatItem` (~218-292): badge `<span className="badge badge--info"><Sparkles size={12}/> Rascunho</span>` em `chat-item__tags`.
- CSS `.pending-bar` baseado em `.reply-bar` (`app.css:1005`): fundo neutro `#FCFCFB` via token, sem gradiente, sem cor nova, respeita `prefers-reduced-motion`.
- `pnpm typecheck` aponta todos os literais `Chat` em testes/UI a corrigir.

### 9. UI — Configurações › IA › "Claude Code" (`ui/settings.tsx`)
- Nova `<section className="surface stack">` com `<h3 className="eyebrow">Claude Code</h3>` após "Rascunho de mensagem" (~731-743): `McpPanel` carrega `api.mcpStatus()`; estados: Claude não encontrado (hint como ~223), "Conectado" / "Não conectado"; botões **Conectar** / **Desconectar** com `loading`; `<code>` com o comando + "Copiar" (`navigator.clipboard.writeText`); hint: "O Claude Code lê suas conversas e propõe respostas; nada é enviado sem você clicar em Enviar. Reinicie as sessões do Claude Code depois de conectar."

## Riscos e cuidados

- `ELECTRON_RUN_AS_NODE=1` transforma o exe em Node puro: `mcp.mjs` não pode usar Electron nem `node:sqlite` (por isso só HTTP). Validar manualmente que responde ao `initialize`.
- Bundle ESM do SDK pode exigir o banner `createRequire`; testar `node dist-electron/mcp.mjs` após `pnpm app`.
- zod 4 × SDK: não instalar duas versões de zod.
- `console.log` no processo MCP corrompe o protocolo.
- BLOB em `node:sqlite`: bind aceita `Buffer`, leitura volta `Uint8Array`.
- Fusão LID → número (`mapLid`) apaga o chat LID e o rascunho cai pela cascata; comentar no código.
- `guard()` com token errado em GET passa a dar 403 (intencional); documentar.
- `findClaudeBin` pode achar `.cmd`: `spawn` sem shell falha → mensagem "Instale o Claude Code nativo".
- Porta/token mudam a cada abertura do app; o cliente relê `mcp.json` por chamada. `mcp.json` órfão após fechamento forçado: `removeMcpFile` também em `will-quit` e antes de instalar atualização.
- `ler_midia` em áudio sem cache chama Groq (custo); dizer na descrição da ferramenta.

## Verificação

1. `pnpm typecheck` e `pnpm test` verdes (novos: `drafts`, `mcp`, `mcp-file`, `mcp-register`; casos novos em `core` e `close`).
2. Dev: `pnpm dev` cria `data/mcp.json`. `claude mcp add --scope user -e INBOX_MCP_FILE="<repo>\data\mcp.json" whatsapp-inbox -- node "<repo>\server\mcp-main.ts"`; `claude mcp get whatsapp-inbox` lista. No `claude`: "liste minhas conversas abertas" → `listar_conversas`; "proponha resposta para X" → banner "Rascunho do Claude" e selo na lista sem recarregar. Testar Enviar (WhatsApp conectado), Editar (texto, citação, anexo restaurados) e Descartar. App fechado → "Abra o WhatsApp Inbox…". `curl -H "x-inbox-token: <token>" http://127.0.0.1:38291/api/chats` → 200; token errado → 403. Configurações › IA › Claude Code: Conectar/Desconectar refletem `claude mcp get`. Ao final `claude mcp remove --scope user whatsapp-inbox`.
3. Empacotado: `pnpm app` → `dist-electron/mcp.mjs` existe; `%APPDATA%\WhatsApp Inbox\mcp.json` criado ao abrir e removido ao sair; Conectar nas Configurações registra `WhatsApp Inbox.exe` + `ELECTRON_RUN_AS_NODE=1`; repetir teste no `claude`. Informar a versão de build publicada.

## Arquivos críticos
`server/http.ts`, `server/db.ts`, `server/app.ts`, `desktop/main.ts`, `server/main.ts`, `ui/main.tsx`, `ui/settings.tsx`, `ui/api.ts`, `scripts/desktop.mjs`. Novos: `server/mcp.ts`, `server/mcp-main.ts`, `server/inbox-client.ts`, `server/mcp-file.ts`, `server/mcp-register.ts`, `server/mime.ts`, `tests/{drafts,mcp,mcp-file,mcp-register}.test.ts`, opcional `tests/fake-api.ts`.
