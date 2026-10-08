# Servidor MCP para o Claude Code — design

Data: 08/10/2026 · Abordagem aprovada: processo stdio separado que fala com a API HTTP local do app (token), rascunho pendente com confirmação na interface.

## Objetivo

Qualquer sessão do Claude Code neste computador enxerga a caixa de entrada do WhatsApp (conversas, mensagens, busca, mídia), organiza conversas e **propõe** respostas. Nada é enviado pelo Claude: a proposta vira um rascunho pendente na conversa e a pessoa decide (Enviar, Editar ou Descartar) dentro do Inbox.

## Estado atual

- `server/claude.ts` chama o Claude Code (`claude -p`) só para rascunho, resumo e transcrição, com leitura do Dataverse liberada.
- A API HTTP local (`server/http.ts`) escuta em 127.0.0.1 sem token; `guard()` só confere Host/Origin.
- O app desktop sobe em porta aleatória (`desktop/main.ts`, `port: 0`); em desenvolvimento a porta é 38291.
- Rascunhos existem apenas na memória da interface (`drafts` em `ui/organize.tsx`).
- Não há dependência do SDK MCP.

## Decisões

- Transporte **stdio**, só este computador, só a conta ativa (principal).
- Envio **nunca direto** pelo MCP.
- Escopo v1: ler conversas, mensagens, busca e mídia (áudio → transcrição, imagem → conteúdo de imagem, demais → arquivo em temp); marcar lida; atualizar status, etiqueta e nota; abrir conversa por telefone; propor texto e propor mídia.
- Registro no Claude Code por botão em Configurações › IA, com o comando copiável.
- Fora de escopo: envio direto, várias contas, push do Inbox para o Claude, configuração do Claude Desktop.

## Design

### 1. Ferramentas (`server/mcp.ts`)

Nomes em pt-BR, snake_case, schemas zod. Leitura: `listar_conversas`, `ler_mensagens`, `buscar_mensagens`, `ler_midia`, `listar_etiquetas`, `perfil_contato`. Organização: `marcar_lida`, `atualizar_conversa`, `abrir_conversa`. Proposta: `propor_resposta` (texto, citação opcional) e `propor_midia` (caminho de arquivo local, legenda). As duas últimas criam o rascunho pendente. Erros voltam como `isError` com texto claro; sem o app aberto, a mensagem é "Abra o WhatsApp Inbox neste computador e tente de novo."

O processo MCP (`server/mcp-main.ts`) só fala HTTP com o app via `server/inbox-client.ts`; não importa Baileys, SQLite nem `app.ts`. Logs só em stderr.

### 2. Rascunho pendente

- Tabela SQLite `drafts` (um por conversa; o mais novo substitui): texto, citação, mídia (blob, mimetype, nome), origem, data.
- `Chat.pendingDraft` resumido (`text`, `hasMedia`, `source`, `createdAt`) em todas as listagens; o SSE `chat` já existente leva a mudança à interface.
- Rotas: `PUT/GET/DELETE /api/chats/:jid/pending-draft`, `GET …/pending-draft/media`, `POST …/pending-draft/send` (usa o envio existente e só limpa se der certo).
- Interface: barra "Rascunho do Claude" no composer com Enviar, Editar (texto, citação e anexo voltam ao campo) e Descartar; selo "Rascunho" na lista de conversas.

### 3. Descoberta e token

- `startApp` gera um token aleatório (64 hex). O desktop grava `%APPDATA%\WhatsApp Inbox\mcp.json` (`port`, `token`, `account`, `pid`) para a conta principal e apaga ao sair; em desenvolvimento, `data/mcp.json`.
- `guard()` aceita o header `x-inbox-token` como alternativa ao Origin: Host local continua obrigatório; token presente e errado dá 403 mesmo em GET; escrita continua exigindo JSON.
- O cliente relê o arquivo a cada chamada, então o app pode reiniciar sem reiniciar o Claude.

### 4. Registro no Claude Code

- Build: `server/mcp-main.ts` → `dist-electron/mcp.mjs` (SDK empacotado). No pacote, o comando registrado é o próprio `WhatsApp Inbox.exe` com `ELECTRON_RUN_AS_NODE=1`; em desenvolvimento, `node server/mcp-main.ts`.
- Rotas `GET /api/mcp/status`, `POST /api/mcp/register`, `POST /api/mcp/unregister` executam `claude mcp get|add|remove --scope user whatsapp-inbox` (sem shell).
- Configurações › IA › "Claude Code": status, Conectar, Desconectar, comando para copiar e aviso de que nada é enviado sem clicar em Enviar.

### 5. Testes

`node:test`: tabela `drafts` no `Store`; rotas do rascunho e `guard()` com fake `Api`; `mcp.json`; montagem dos argumentos do `claude mcp`; servidor MCP com `InMemoryTransport` e `fetch` falso. Fluxo manual em dev e no pacote descrito no plano.
