# Notificações do Windows — plano de implementação

> **Para agentes:** sub-skill obrigatória: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com checkbox (`- [ ]`).

**Objetivo:** notificações agrupadas por conversa, com conteúdo legível, ações no toast (responder / marcar como lida) e contador de não lidas na barra de tarefas.

**Arquitetura:** funções puras de formatação/contagem em `desktop/notifications.ts` (testáveis sem Electron); `server/app.ts` expõe `send`/`markRead` e avisa `onRead`; `desktop/main.ts` usa a API nativa do Electron 44 (`id`, `groupId`, `actions`, `hasReply`, `urgency`); a página desenha o badge em `<canvas>` e o manda por IPC.

**Stack:** Electron 44.4.5, TypeScript 6 (type stripping do Node), React, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-07-windows-notifications-design.md`

## Restrições globais

- Textos em pt-BR com acentos; arquivos em UTF-8.
- Sem `toastXml`; só API nativa do Electron 44.
- Badge usa só tokens existentes (`--bt-color-action`, `--bt-color-white`) lidos via `getComputedStyle`; sem cores novas, sem gradiente.
- Lembretes continuam avisando no horário de silêncio e com o app em foco.
- Validação: `pnpm typecheck` e `pnpm test` verdes ao fim de cada tarefa.
- Commits em português, detalhados, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Tarefa 1: formatação e contador (`desktop/notifications.ts`)

**Arquivos:**
- Criar: `desktop/notifications.ts`
- Teste: `tests/notifications.test.ts`

**Interfaces:**
- Produz:
  - `notificationBody(message: Pick<Message, "text" | "media">, preview: boolean): string`
  - `notificationTitle(chat: Pick<Chat, "name" | "ai">, count: number): string`
  - `isUrgent(chat: Pick<Chat, "ai">): boolean`
  - `class UnreadCounter { bump(jid: string): number; clear(jid: string): void; get(jid: string): number }`

- [ ] **Passo 1: teste que falha** — `tests/notifications.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isUrgent, notificationBody, notificationTitle, UnreadCounter } from "../desktop/notifications.ts";

const msg = (text: string, media: { seconds: number | null } | null = null) => ({
  text,
  media: media ? { type: "audio", mimetype: "audio/ogg", fileName: null, size: null, seconds: media.seconds, ptt: true } : null,
});

test("corpo: texto simples, corte em 180 e preview desligado", () => {
  assert.equal(notificationBody(msg("Bom dia"), true), "Bom dia");
  assert.equal(notificationBody(msg("x".repeat(200)), true), `${"x".repeat(179)}…`);
  assert.equal(notificationBody(msg("segredo"), false), "Nova mensagem");
});

test("corpo: mídia vira rótulo amigável e preserva autor e legenda", () => {
  assert.equal(notificationBody(msg("[Imagem] olha isso"), true), "📷 Foto olha isso");
  assert.equal(notificationBody(msg("Ana: [Imagem]"), true), "Ana: 📷 Foto");
  assert.equal(notificationBody(msg("[Áudio]", { seconds: 72 }), true), "🎤 Áudio 1:12");
  assert.equal(notificationBody(msg("[Áudio]", { seconds: null }), true), "🎤 Áudio");
  assert.equal(notificationBody(msg("[Documento] nota.pdf"), true), "📄 nota.pdf");
  assert.equal(notificationBody(msg("[Documento]"), true), "📄 Documento");
  assert.equal(notificationBody(msg("[Arquivo de áudio]"), true), "🎵 Áudio");
  assert.equal(notificationBody(msg("[Vídeo]"), true), "🎥 Vídeo");
  assert.equal(notificationBody(msg("[GIF]"), true), "🎞️ GIF");
  assert.equal(notificationBody(msg("[Localização] Av. Paulista"), true), "📍 Localização Av. Paulista");
  assert.equal(notificationBody(msg("[Contatos]"), true), "👤 Contato");
  assert.equal(notificationBody(msg("[Enquete] Horário?"), true), "📊 Enquete Horário?");
  assert.equal(notificationBody(msg("[Figurinha]"), true), "Figurinha");
});

test("título: contador e urgência", () => {
  const ai = (priority: "alta" | "media" | "baixa" | null) =>
    ({ label: "Reserva", confidence: 1, needsReply: 1, urgent: 0, priority, reason: null, at: 0 });
  assert.equal(notificationTitle({ name: "Ana", ai: null }, 1), "Ana");
  assert.equal(notificationTitle({ name: "Ana", ai: null }, 3), "Ana · 3 novas");
  assert.equal(notificationTitle({ name: "Ana", ai: ai("alta") }, 2), "Urgente · Ana · 2 novas");
  assert.equal(isUrgent({ ai: ai("alta") }), true);
  assert.equal(isUrgent({ ai: ai("media") }), false);
  assert.equal(isUrgent({ ai: null }), false);
});

test("contador por conversa", () => {
  const c = new UnreadCounter();
  assert.equal(c.bump("a"), 1);
  assert.equal(c.bump("a"), 2);
  assert.equal(c.bump("b"), 1);
  c.clear("a");
  assert.equal(c.get("a"), 0);
  assert.equal(c.bump("a"), 1);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test tests/notifications.test.ts`
Esperado: FAIL, módulo `../desktop/notifications.ts` não encontrado.

- [ ] **Passo 3: implementação** — `desktop/notifications.ts`

```ts
// Texto das notificações do Windows: funções puras, sem Electron, para poder testar.
import type { Chat, Message } from "../server/db.ts";

const MAX = 180;

/** Etiquetas de mídia geradas em server/text.ts → rótulo amigável no toast. */
const LABELS: Record<string, string> = {
  Imagem: "📷 Foto",
  Vídeo: "🎥 Vídeo",
  GIF: "🎞️ GIF",
  "Arquivo de áudio": "🎵 Áudio",
  Figurinha: "Figurinha",
  Localização: "📍 Localização",
  Contato: "👤 Contato",
  Contatos: "👤 Contato",
  Enquete: "📊 Enquete",
};

const TAG = /\[(Imagem|Vídeo|GIF|Áudio|Arquivo de áudio|Documento|Figurinha|Localização|Contatos?|Enquete)\]( ?)(.*)$/s;

const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function notificationBody(message: Pick<Message, "text" | "media">, preview: boolean): string {
  if (!preview) return "Nova mensagem";
  const text = message.text.replace(TAG, (_all, tag: string, space: string, rest: string) => {
    if (tag === "Documento") return `📄 ${rest || "Documento"}`;
    if (tag === "Áudio") {
      const seconds = message.media?.seconds;
      return `🎤 Áudio${seconds ? ` ${duration(seconds)}` : ""}${space}${rest}`;
    }
    return `${LABELS[tag]}${space}${rest}`;
  });
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}

export const isUrgent = (chat: Pick<Chat, "ai">): boolean => chat.ai?.priority === "alta";

export function notificationTitle(chat: Pick<Chat, "name" | "ai">, count: number): string {
  const base = count > 1 ? `${chat.name} · ${count} novas` : chat.name;
  return isUrgent(chat) ? `Urgente · ${base}` : base;
}

/** Mensagens novas desde a última vez que a conversa foi aberta ou lida. */
export class UnreadCounter {
  private counts = new Map<string, number>();
  bump(jid: string): number {
    const next = (this.counts.get(jid) ?? 0) + 1;
    this.counts.set(jid, next);
    return next;
  }
  clear(jid: string): void {
    this.counts.delete(jid);
  }
  get(jid: string): number {
    return this.counts.get(jid) ?? 0;
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `node --test tests/notifications.test.ts` → PASS. Depois `pnpm typecheck` → sem erros.

- [ ] **Passo 5: commit**

```bash
git add desktop/notifications.ts tests/notifications.test.ts
git commit -F <arquivo-de-mensagem>
```
Mensagem: `feat(notificações): formatação de título/corpo e contador por conversa` + corpo descrevendo rótulos de mídia, corte em 180, urgência e contador.

---

### Tarefa 2: servidor expõe `send`/`markRead` e avisa `onRead`

**Arquivos:**
- Modificar: `server/app.ts` (opções ~linha 33-40, tipo `RunningApp` linha 43, handler ~265-274, retorno ~379-381)
- Teste: `tests/close.test.ts` (novo teste no mesmo arquivo, que já sobe `startApp` com `waDisabled`)

**Interfaces:**
- Produz:
  - `StartOptions.onRead?: (jid: string) => void`
  - `RunningApp = { port; prefs; send: (jid: string, text: string) => Promise<void>; markRead: (jid: string) => Promise<void>; close }`

- [ ] **Passo 1: teste que falha** — acrescentar em `tests/close.test.ts`:

```ts
test("markRead avisa onRead e send sem WhatsApp falha com mensagem clara", async () => {
  const read: string[] = [];
  const app = await startApp({
    port: 0,
    dataDir: mkdtempSync(join(tmpdir(), "wi-read-")),
    distDir: "dist",
    waDisabled: true,
    onRead: (jid) => read.push(jid),
  });
  try {
    await app.markRead("5511999999999@s.whatsapp.net");
    assert.deepEqual(read, ["5511999999999@s.whatsapp.net"]);
    await assert.rejects(app.send("5511999999999@s.whatsapp.net", "oi"), /WhatsApp ainda está iniciando/);
  } finally {
    await app.close();
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test tests/close.test.ts` → FAIL (`app.markRead is not a function` / erro de tipo).

- [ ] **Passo 3: implementação** em `server/app.ts`

Nas opções, logo após `onReminder`:

```ts
  /** Conversa marcada como lida (na página ou pelo toast): o app desktop zera a notificação. */
  onRead?: (jid: string) => void;
```

Tipo:

```ts
export type RunningApp = {
  port: number;
  prefs: () => Prefs;
  send: (jid: string, text: string) => Promise<void>;
  markRead: (jid: string) => Promise<void>;
  close: () => Promise<void>;
};
```

Antes de `const handler = createHandler({`, extrair as duas funções (mesmo corpo de hoje, mais `onRead`):

```ts
  const send = async (jid: string, text: string) => {
    await connected().send(jid, text);
  };
  const markRead = async (jid: string) => {
    const keys = store.markRead(jid);
    broadcast("chat", store.getChat(jid));
    options.onRead?.(jid);
    await wa?.markRead(keys).catch(() => undefined); // recibo de leitura é cortesia, não bloqueia
  };
```

No `createHandler`, trocar as entradas inline por `send,` e `markRead,`. No objeto retornado, após `prefs: () => readPrefs(store),` acrescentar `send,` e `markRead,`.

Conferir: `broadcast("chat", null)` quando a conversa não existe já era o comportamento do handler; o teste cobre esse caminho sem quebrar.

- [ ] **Passo 4: rodar e ver passar**

Run: `node --test tests/close.test.ts` → PASS; `pnpm typecheck` → sem erros; `pnpm test` → tudo verde.

- [ ] **Passo 5: commit** — `feat(servidor): expõe send/markRead ao app desktop e avisa onRead`, corpo explicando a extração sem mudar comportamento HTTP.

---

### Tarefa 3: toast agrupado, urgência, ações e piscar a janela (`desktop/main.ts`)

**Arquivos:**
- Modificar: `desktop/main.ts` (import linha 3-8, estado 19-20, `notify` 43-63, `remind` 66-81, `createWindow` 83-132, `startApp` 173-180)

**Interfaces:**
- Consome: `notificationBody`, `notificationTitle`, `isUrgent`, `UnreadCounter` (Tarefa 1); `server.send`, `server.markRead`, `onRead` (Tarefa 2).
- Produz: nada para outras tarefas; `clearChat(jid: string): void` é interna ao `main.ts`.

- [ ] **Passo 1: imports e estado** — substituir linhas 6 e 19-20:

```ts
import type { Chat, Message, Reminder } from "../server/db.ts";
import { isUrgent, notificationBody, notificationTitle, UnreadCounter } from "./notifications.ts";
```

```ts
// Um toast vivo por conversa: sem referência, o Windows pode descartar o clique;
// com ela, a mensagem seguinte fecha a anterior e mostra o total.
const byChat = new Map<string, Notification>();
const reminders = new Set<Notification>();
const counter = new UnreadCounter();
```

- [ ] **Passo 2: helpers e `notify`** — substituir `notify` (linhas 43-63):

```ts
/** Conversa vista ou lida: some o toast e a contagem recomeça. */
function clearChat(jid: string) {
  counter.clear(jid);
  byChat.get(jid)?.close();
  byChat.delete(jid);
  Notification.removeGroup(jid);
}

function openChat(jid: string) {
  showWindow();
  sendToPage("app:open-chat", jid);
  clearChat(jid);
}

function failure(chat: Chat, title: string, detail: string) {
  const n = new Notification({ title, body: detail.slice(0, 180), icon: iconPath(), groupId: chat.jid, groupTitle: chat.name });
  reminders.add(n);
  n.on("click", () => openChat(chat.jid));
  n.on("close", () => reminders.delete(n));
  n.show();
}

function notify(chat: Chat, message: Message) {
  const prefs = server?.prefs();
  if (!prefs?.notifyEnabled || !Notification.isSupported()) return;
  // Com o app na frente a mensagem já aparece na tela.
  if (window?.isVisible() && window.isFocused()) return;
  if (inQuietHours(prefs)) return;
  window?.flashFrame(true);
  const count = counter.bump(chat.jid);
  byChat.get(chat.jid)?.close();
  const n = new Notification({
    id: chat.jid,
    groupId: chat.jid,
    groupTitle: chat.name,
    title: notificationTitle(chat, count),
    body: notificationBody(message, prefs.notifyPreview),
    silent: !prefs.notifySound,
    urgency: isUrgent(chat) ? "critical" : "normal",
    icon: iconPath(),
    hasReply: true,
    replyPlaceholder: "Responder…",
    actions: [{ type: "button", text: "Marcar como lida" }],
  });
  byChat.set(chat.jid, n);
  n.on("click", () => openChat(chat.jid));
  n.on("action", () => {
    server?.markRead(chat.jid).catch((e: Error) => failure(chat, `Não foi possível marcar ${chat.name} como lida`, e.message));
  });
  n.on("reply", (_event, reply) => {
    const text = reply.trim();
    if (!text || !server) return;
    server
      .send(chat.jid, text)
      .then(() => server?.markRead(chat.jid))
      .catch((e: Error) => failure(chat, `Mensagem não enviada para ${chat.name}`, `${e.message} Texto: ${text}`));
  });
  n.on("close", () => {
    if (byChat.get(chat.jid) === n) byChat.delete(chat.jid);
  });
  n.show();
}
```

Nota para o executor: confira no `electron.d.ts` a assinatura de `reply`. Em Electron 44 o primeiro argumento é `Event<NotificationReplyEventParams>` (com `.reply`) e o segundo, `reply: string`, está marcado como deprecated. Se o typecheck reclamar do argumento deprecated, use `(event) => event.reply`. O mesmo vale para `action` (`event.actionIndex`). Só existe uma ação, então o índice não importa.

- [ ] **Passo 3: `remind`** — trocar `shown` por `reminders` e acrescentar `groupId: chat.jid, groupTitle: chat.name`; o clique passa a chamar `openChat(chat.jid)`. Mantém o aviso no silêncio e com o app em foco.

- [ ] **Passo 4: parar de piscar e ligar `onRead`**
  - Em `createWindow`, após `window.once("ready-to-show", ...)`: `window.on("focus", () => window?.flashFrame(false));`
  - Em `startApp({...})`: `onRead: clearChat,`

- [ ] **Passo 5: verificar**

Run: `pnpm typecheck` → sem erros; `pnpm test` → verde; `pnpm build` → conclui sem erro.

- [ ] **Passo 6: commit** — `feat(notificações): toast único por conversa com contador, urgência e ações`, corpo listando substituição por `id`/`groupId`, `removeGroup` ao ler, responder inline, marcar como lida, toast de erro com o texto e `flashFrame`.

---

### Tarefa 4: contador na barra de tarefas e na bandeja

**Arquivos:**
- Criar: `ui/badge.ts`
- Modificar: `desktop/preload.ts`, `ui/desktop.ts`, `ui/main.tsx` (efeito no `App`, perto da linha 979), `desktop/main.ts` (IPC + bandeja)

**Interfaces:**
- Produz: `DesktopBridge.setUnread(total: number, image: string | null): void`; IPC `app:unread`; `badgeImage(total: number): string` em `ui/badge.ts`.

- [ ] **Passo 1: desenho do badge** — `ui/badge.ts`

```ts
// Círculo 16×16 com o total de não lidas, para o ícone da barra de tarefas do Windows.
// Cores lidas dos tokens do design system (nada de valor novo).
export function badgeImage(total: number): string {
  const size = 32; // desenha em 2x; o Windows reduz para 16
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue("--bt-color-action").trim();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const label = total > 99 ? "99+" : String(total);
  ctx.fillStyle = css.getPropertyValue("--bt-color-white").trim();
  ctx.font = `800 ${label.length > 2 ? 13 : label.length > 1 ? 17 : 20}px ${css.getPropertyValue("font-family") || "sans-serif"}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2 + 1);
  return canvas.toDataURL("image/png");
}
```

- [ ] **Passo 2: ponte** — `desktop/preload.ts`, dentro do objeto exposto:

```ts
  setUnread: (total: number, image: string | null) => ipcRenderer.send("app:unread", total, image),
```

`ui/desktop.ts`, no tipo `DesktopBridge`:

```ts
  setUnread: (total: number, image: string | null) => void;
```

- [ ] **Passo 3: página envia o total** — `ui/main.tsx`, import `import { badgeImage } from "./badge.ts";` e, logo após o efeito de `onOpenChat` (linha ~992):

```tsx
  // Total de não lidas no ícone da barra de tarefas e na bandeja (só no app desktop).
  const unreadTotal = useMemo(() => [...chats.values()].reduce((sum, c) => sum + (c.unread > 0 ? c.unread : 0), 0), [chats]);
  useEffect(() => {
    desktop()?.setUnread(unreadTotal, unreadTotal > 0 ? badgeImage(unreadTotal) : null);
  }, [unreadTotal]);
```

- [ ] **Passo 4: main aplica, com validação** — `desktop/main.ts`: acrescentar `ipcMain` ao import de `electron` e, dentro de `app.whenReady().then(...)`, após `buildTrayMenu();`:

```ts
    // Contador vindo da página: só aceita número inteiro e PNG em data URL.
    ipcMain.on("app:unread", (event, total: unknown, image: unknown) => {
      if (!origin || new URL(event.senderFrame?.url ?? "about:blank").origin !== origin) return;
      const n = Number.isInteger(total) && (total as number) >= 0 ? (total as number) : 0;
      const png = typeof image === "string" && image.startsWith("data:image/png;base64,") ? image : null;
      window?.setOverlayIcon(n > 0 && png ? nativeImage.createFromDataURL(png) : null, n > 0 ? `${n} não lidas` : "");
      tray?.setToolTip(n > 0 ? `${PRODUCT} — ${n} não lidas` : PRODUCT);
    });
```

- [ ] **Passo 5: verificar**

Run: `pnpm typecheck`, `pnpm test`, `pnpm build` → verdes. Em `pnpm dev` no navegador, `desktop()` é `undefined` e nada quebra; abrir o console e confirmar que não há erro.

- [ ] **Passo 6: commit** — `feat(desktop): contador de não lidas na barra de tarefas e na bandeja`, corpo descrevendo badge com tokens, IPC validado por origem e formato, tooltip.

---

### Tarefa 5: validação no app empacotado

**Arquivos:** nenhum (só verificação); se algo falhar, corrigir na tarefa de origem com novo commit.

- [ ] **Passo 1:** gerar e instalar o build (script de release/instalador já usado no projeto, que incrementa a versão). Anotar a versão exibida no app.
- [ ] **Passo 2:** com a janela minimizada, receber 3 mensagens da mesma conversa → um único toast `Nome · 3 novas` com a última mensagem; o ícone da barra pisca.
- [ ] **Passo 3:** foto, áudio e documento → `📷 Foto`, `🎤 Áudio m:ss`, `📄 nome`; em grupo aparece `Autor: …`.
- [ ] **Passo 4:** responder pelo toast → mensagem chega no WhatsApp do contato; toast some; badge diminui.
- [ ] **Passo 5:** "Marcar como lida" → badge e lista atualizam; Central de Ações sem toasts daquela conversa.
- [ ] **Passo 6:** abrir a conversa pela lista do app → contador zera (próxima mensagem mostra só `Nome`).
- [ ] **Passo 7:** conversa com prioridade alta → toast `Urgente · …` fica na tela até dispensar.
- [ ] **Passo 8:** WhatsApp desconectado + responder pelo toast → toast "Mensagem não enviada para …" com o texto digitado.
- [ ] **Passo 9:** horário de silêncio ativo → nada de toast nem piscar; lembrete continua aparecendo.

Se ações/resposta não dispararem no app instalado, registrar o comportamento (versão do Windows, AUMID no atalho) antes de qualquer correção.
