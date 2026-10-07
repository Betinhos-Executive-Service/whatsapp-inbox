# Notificações do Windows — design

Data: 07/10/2026 · Abordagem aprovada: API nativa do Electron 44 (sem `toastXml`).

## Objetivo

Trocar o "um toast por mensagem, texto cru" por notificações agrupadas por conversa, com conteúdo legível, ações no próprio toast e contador de não lidas na barra de tarefas.

## Estado atual

- `desktop/main.ts` `notify()` cria um `Notification` por mensagem recebida ao vivo (`server/app.ts` → `onIncoming`).
- Título = nome da conversa; corpo = `message.text.slice(0, 180)`. Mídia chega como `[Imagem] legenda`, `[Áudio]` etc. (`server/text.ts`). Em grupo o texto já vem como `Autor: texto` (`server/whatsapp.ts`).
- Clique abre a janela e a conversa (`app:open-chat`). Sem agrupamento, ações ou contador.
- Preferências respeitadas: `notifyEnabled`, `notifySound`, `notifyPreview`, horário de silêncio, app em foco.

## Design

### 1. Módulo `desktop/notifications.ts`

Funções puras, testáveis sem Electron:

- `notificationBody(message, preview)`: com `preview` desligado → `Nova mensagem`. Ligado → troca a primeira etiqueta de mídia por um rótulo amigável, preservando o prefixo `Autor: ` e a legenda:
  - `[Imagem]` → `📷 Foto`; `[Vídeo]` → `🎥 Vídeo`; `[GIF]` → `🎞️ GIF`
  - `[Áudio]` → `🎤 Áudio 0:12` (duração de `media.seconds`, omitida se ausente); `[Arquivo de áudio]` → `🎵 Áudio`
  - `[Documento] nome` → `📄 nome`; `[Figurinha]` → `Figurinha`; `[Localização]` → `📍 Localização`; `[Contato]`/`[Contatos]` → `👤 Contato`; `[Enquete]` → `📊 Enquete`
  - Corta em 180 caracteres com `…`.
- `notificationTitle(chat, count)`: `Nome` com 1 mensagem; `Nome · 3 novas` com mais. Com `chat.ai?.priority === "alta"`, prefixo `Urgente · `.
- Contador por conversa (`Map<jid, number>`): `bump(jid)`, `clear(jid)`, `clearAll()`.

### 2. Agrupamento (substituição)

- Cada toast usa `id = jid` e `groupId = jid` (`groupTitle = chat.name`). Antes de mostrar, fecha o toast anterior da mesma conversa (mantido em `Map<jid, Notification>`), então só existe um por conversa, com contador e última mensagem.
- O contador zera quando: a conversa é aberta pelo toast, a ação "Marcar como lida" roda, ou o servidor marca a conversa como lida (novo callback `onRead(jid)` em `startApp`, chamado no `markRead` existente). Ao zerar, `Notification.removeGroup(jid)` limpa a Central de Ações.

### 3. Urgência

- `chat.ai?.priority === "alta"` → `urgency: "critical"` (fica na tela até ser dispensado). Demais → `normal`. A classificação roda depois da chegada, então vale a prioridade já conhecida da conversa.

### 4. Ações no toast

- `actions: [{ type: "button", text: "Marcar como lida" }]`, `hasReply: true`, `replyPlaceholder: "Responder…"`.
- `RunningApp` ganha `send(jid, text)` e `markRead(jid)`, reaproveitando as funções já passadas ao handler HTTP (sem duplicar lógica).
- `reply` → `send`; sucesso zera o contador da conversa e marca como lida. Falha → toast `Mensagem não enviada para <Nome>` com o erro; clique abre a conversa. Texto não é perdido: o toast de erro mostra o início do texto.
- `action` "Marcar como lida" → `markRead(jid)`; falha → toast de erro.
- Lembretes (`remind`) mantêm o comportamento atual (sem agrupamento, avisam no silêncio), ganhando só `groupId = jid`.

### 5. Barra de tarefas e bandeja

- A página calcula o total de não lidas (soma de `chat.unread` das conversas carregadas) sempre que a lista muda e chama `window.desktop.setUnread(total, dataUrl)`; `dataUrl` é um círculo 16×16 com o número (`99+` acima de 99), desenhado em `<canvas>` com cores do design system.
- Preload expõe `setUnread`; `main.ts` aplica `window.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), "N não lidas")` (ou `null` com 0) e `tray.setToolTip("WhatsApp Inbox — N não lidas")`. Valida no main: inteiro ≥ 0 e `dataUrl` começando com `data:image/png;base64,`.
- Mensagem nova com a janela sem foco → `window.flashFrame(true)`; para ao focar (`focus` → `flashFrame(false)`). Respeita `notifyEnabled` e horário de silêncio.

### 6. Foto de perfil arredondada (adendo aprovado em 07/10/2026)

- **Busca:** `WhatsApp.profilePhotoUrl(jid)` chama `sock.profilePictureUrl(jid, "preview")`; sem conexão ou sem foto (privacidade) → `null`.
- **Cache:** `server/avatars.ts` grava a foto baixada em `<dataDir>/avatars/<hash do jid>.jpg` e a ausência em `<hash>.none`; ambos valem 24 h. `RunningApp.avatar(jid): Promise<string | null>` devolve o caminho do arquivo ou `null`. Falha de rede = `null`, sem lançar.
- **Arredondar:** o Windows não recorta o `icon` sem `toastXml` (que quebraria `actions`/`hasReply`/`id`). Então o app recorta: `desktop/avatar.ts` redimensiona para 96×96 com `nativeImage`, aplica máscara circular com borda suavizada nos bytes BGRA (`toBitmap` → alfa → `createFromBitmap`) e grava um PNG transparente em `<userData>/avatars-round/`. O Windows exibe o PNG com transparência, então a foto aparece em círculo.
- **Toast:** `notify` não espera mais que 1,5 s pela foto; sem foto a tempo usa o ícone do app. O contador sobe antes da espera; o toast usa a contagem atual ao ser criado. Lembretes também usam a foto.

## Fora do escopo

`toastXml`, novas preferências na tela de Configurações, mudanças no servidor além de `onRead` e da exposição de `send`/`markRead`.

## Riscos

- Ações e resposta inline no Windows dependem do AUMID registrado no atalho do instalador; em `pnpm dev` (electron.exe genérico) podem não disparar. Validação real só no app empacotado.
- `id`/`groupId` no Windows exigem o mesmo AUMID; sem ele, o fechamento manual do toast anterior garante a substituição.
- Janela oculta com `backgroundThrottling` ainda recebe os eventos da página; se o badge atrasar, desligar o throttling da janela.

## Testes

- `tests/notifications.test.ts` (node --test): corpo por tipo de mídia, prefixo de autor, duração do áudio, corte em 180, preview desligado, título com contador e urgência, contador bump/clear.
- `pnpm typecheck` e `pnpm test`.
- Manual no app empacotado: 3 mensagens da mesma conversa → 1 toast "· 3 novas"; responder pelo toast chega no WhatsApp; "Marcar como lida" zera badge; badge e tooltip batem com a lista; piscar para ao focar.
