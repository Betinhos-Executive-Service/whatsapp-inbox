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

### Tarefa 5: foto de perfil no servidor (busca + cache de 24 h)

**Arquivos:**
- Criar: `server/avatars.ts`
- Modificar: `server/whatsapp.ts` (novo método perto de `send`, ~linha 286), `server/app.ts` (tipo `RunningApp`, criação do cache antes de `createHandler`, objeto retornado)
- Teste: `tests/avatars.test.ts`; acrescentar caso em `tests/close.test.ts`

**Interfaces:**
- Produz:
  - `WhatsApp.profilePhotoUrl(jid: string): Promise<string | null>`. Sem conexão, lança. Sem foto ou com privacidade, devolve `null`.
  - `avatarCache(dir: string, source: (jid: string) => Promise<string | null>, fetcher?: typeof fetch, now?: () => number): (jid: string) => Promise<string | null>`
  - `RunningApp.avatar: (jid: string) => Promise<string | null>`, que devolve o caminho de um `.jpg` local ou `null`.

- [ ] **Passo 1: teste que falha**: `tests/avatars.test.ts`

```ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { avatarCache } from "../server/avatars.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const okFetch = (async () => new Response(JPEG, { status: 200 })) as unknown as typeof fetch;

test("avatar: baixa, guarda e reaproveita por 24 h", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  const get = avatarCache(dir, async () => (calls++, "https://pps.whatsapp.net/x.jpg"), okFetch);
  const first = await get("5511999999999@s.whatsapp.net");
  assert.ok(first && first.endsWith(".jpg"));
  assert.deepEqual(readFileSync(first), JPEG);
  assert.equal(await get("5511999999999@s.whatsapp.net"), first);
  assert.equal(calls, 1);
});

test("avatar: sem foto fica em cache como ausente; expira depois de 24 h", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  let now = Date.now();
  const get = avatarCache(dir, async () => (calls++, null), okFetch, () => now);
  assert.equal(await get("g@g.us"), null);
  assert.equal(await get("g@g.us"), null);
  assert.equal(calls, 1);
  now += 25 * 60 * 60 * 1000;
  assert.equal(await get("g@g.us"), null);
  assert.equal(calls, 2);
});

test("avatar: falha da fonte ou do download devolve null e não grava ausência", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  const offline = avatarCache(dir, async () => {
    calls++;
    throw new Error("O WhatsApp não está conectado.");
  }, okFetch);
  assert.equal(await offline("a@s.whatsapp.net"), null);
  assert.equal(await offline("a@s.whatsapp.net"), null);
  assert.equal(calls, 2);
  const broken = avatarCache(dir, async () => "https://x/y.jpg", (async () => new Response("", { status: 404 })) as unknown as typeof fetch);
  assert.equal(await broken("b@s.whatsapp.net"), null);
});

test("avatar: chamadas simultâneas da mesma conversa fazem uma busca só", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  const get = avatarCache(dir, async () => (calls++, "https://x/y.jpg"), okFetch);
  const [a, b] = await Promise.all([get("c@s.whatsapp.net"), get("c@s.whatsapp.net")]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  assert.ok(a && existsSync(a));
});
```

Em `tests/close.test.ts`, um teste novo:

```ts
test("avatar sem WhatsApp devolve null sem travar", async () => {
  const app = await startApp({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "wi-av-app-")), distDir: "dist", waDisabled: true });
  try {
    assert.equal(await app.avatar("5511999999999@s.whatsapp.net"), null);
  } finally {
    await app.close();
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test tests/avatars.test.ts tests/close.test.ts`. Deve falhar: o módulo não existe e `app.avatar` não é função.

- [ ] **Passo 3: implementação**

`server/avatars.ts`:

```ts
// Fotos de perfil para a notificação do Windows: um arquivo por conversa, válido por 24 h.
// "Sem foto" também fica guardado (arquivo .none) para não perguntar ao WhatsApp a cada mensagem.
import { createHash } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TTL = 24 * 60 * 60 * 1000;

export function avatarCache(
  dir: string,
  source: (jid: string) => Promise<string | null>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): (jid: string) => Promise<string | null> {
  const pending = new Map<string, Promise<string | null>>();
  const fresh = async (path: string) => {
    try {
      return now() - (await stat(path)).mtimeMs < TTL;
    } catch {
      return false;
    }
  };

  async function load(jid: string): Promise<string | null> {
    const key = createHash("sha1").update(jid).digest("hex").slice(0, 16);
    const photo = join(dir, `${key}.jpg`);
    const none = join(dir, `${key}.none`);
    if (await fresh(photo)) return photo;
    if (await fresh(none)) return null;
    try {
      // Fonte que lança (ex.: WhatsApp desconectado) não vira "sem foto": tenta de novo depois.
      const url = await source(jid);
      await mkdir(dir, { recursive: true });
      if (!url) {
        await writeFile(none, "");
        return null;
      }
      const res = await fetcher(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      await writeFile(photo, Buffer.from(await res.arrayBuffer()));
      await unlink(none).catch(() => undefined);
      return photo;
    } catch {
      return null;
    }
  }

  return (jid) => {
    let p = pending.get(jid);
    if (!p) {
      p = load(jid).finally(() => pending.delete(jid));
      pending.set(jid, p);
    }
    return p;
  };
}
```

Nota para o executor: o teste de expiração injeta `now` 25 h no futuro. O `.none` gravado tem `mtimeMs` real, então `now() - mtimeMs` passa de 24 h e a fonte é chamada de novo. Isso está correto.

`server/whatsapp.ts`, logo antes de `async send(`:

```ts
  /** Miniatura da foto de perfil. Sem conexão lança; sem foto ou com privacidade devolve null. */
  async profilePhotoUrl(jid: string): Promise<string | null> {
    if (!this.sock || this.state.status !== "conectado") throw new Error("O WhatsApp não está conectado.");
    try {
      return (await this.sock.profilePictureUrl(jid, "preview")) ?? null;
    } catch {
      return null; // o WhatsApp responde erro quando não há foto visível para você
    }
  }
```

`server/app.ts`:
- `import { avatarCache } from "./avatars.ts";`
- No tipo `RunningApp`, depois de `markRead`: `avatar: (jid: string) => Promise<string | null>;`
- Logo depois das funções `send`/`markRead` extraídas na Tarefa 2:

```ts
  const avatar = avatarCache(join(options.dataDir, "avatars"), (jid) => connected().profilePhotoUrl(jid));
```

- No objeto retornado, depois de `markRead,`: `avatar,`

- [ ] **Passo 4: rodar e ver passar**: `node --test tests/avatars.test.ts tests/close.test.ts`, depois `pnpm typecheck` e `pnpm test`.

- [ ] **Passo 5: commit**: `feat(servidor): foto de perfil com cache de 24 h para as notificações`. No corpo, explicar a busca em miniatura, o cache de ausência, que uma falha de conexão não é cacheada e que buscas simultâneas da mesma conversa são deduplicadas.

---

### Tarefa 6: foto arredondada no toast (`desktop/`)

**Arquivos:**
- Criar: `desktop/avatar-mask.ts` (puro, testável) e `desktop/avatar.ts` (usa `nativeImage`)
- Modificar: `desktop/main.ts` (`notify`, `remind`)
- Teste: `tests/avatar-mask.test.ts`

**Interfaces:**
- Consome: `RunningApp.avatar(jid)` da Tarefa 5. Também `counter`, `byChat`, `clearChat` e `openChat`, já existentes em `desktop/main.ts` desde a Tarefa 3.
- Produz: `circleMask(bgra: Buffer, size: number): Buffer` e `roundAvatar(photo: string, outDir: string): Promise<string | null>`

- [ ] **Passo 1: teste que falha**: `tests/avatar-mask.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { circleMask } from "../desktop/avatar-mask.ts";

const SIZE = 96;
const alpha = (buf: Buffer, x: number, y: number) => buf[(y * SIZE + x) * 4 + 3];

test("máscara circular: cantos transparentes, miolo e bordas do círculo opacos, borda suavizada", () => {
  const out = circleMask(Buffer.alloc(SIZE * SIZE * 4, 255), SIZE);
  assert.equal(alpha(out, 0, 0), 0);
  assert.equal(alpha(out, SIZE - 1, SIZE - 1), 0);
  assert.equal(alpha(out, 13, 13), 0);
  assert.equal(alpha(out, 48, 48), 255);
  assert.equal(alpha(out, 0, 48), 255);
  assert.equal(alpha(out, 48, 0), 255);
  let partial = 0;
  for (let i = 3; i < out.length; i += 4) if (out[i] > 0 && out[i] < 255) partial++;
  assert.ok(partial > 0, "borda precisa de pixels semitransparentes");
});

test("máscara circular: pré-multiplica as cores junto com o alfa e não altera a entrada", () => {
  const input = Buffer.alloc(SIZE * SIZE * 4, 200);
  const out = circleMask(input, SIZE);
  assert.equal(input[3], 200);
  const i = 0;
  assert.deepEqual([out[i], out[i + 1], out[i + 2], out[i + 3]], [0, 0, 0, 0]);
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test tests/avatar-mask.test.ts`

- [ ] **Passo 3: implementação**

`desktop/avatar-mask.ts`:

```ts
// Recorte circular da foto de perfil, direto nos bytes BGRA (sem canvas no processo principal).
// O Windows não arredonda o ícone do toast sem toastXml; um PNG com fundo transparente resolve.

/** Aplica um círculo com borda suavizada; as cores são multiplicadas junto (BGRA pré-multiplicado do Chromium). */
export function circleMask(bgra: Buffer, size: number): Buffer {
  const out = Buffer.from(bgra);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coverage = Math.min(1, Math.max(0, r - Math.hypot(x + 0.5 - r, y + 0.5 - r) + 0.5));
      if (coverage === 1) continue;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 4; k++) out[i + k] = Math.round(out[i + k] * coverage);
    }
  }
  return out;
}
```

`desktop/avatar.ts`:

```ts
// Foto de perfil pronta para o toast: 96×96, recortada em círculo, PNG transparente.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { nativeImage } from "electron";
import { circleMask } from "./avatar-mask.ts";

const SIZE = 96;

export async function roundAvatar(photo: string, outDir: string): Promise<string | null> {
  const out = join(outDir, basename(photo).replace(/\.jpg$/, ".png"));
  try {
    // Reaproveita o recorte enquanto a foto de origem não mudar.
    if ((await stat(out)).mtimeMs >= (await stat(photo)).mtimeMs) return out;
  } catch {
    // ainda não recortada
  }
  try {
    const image = nativeImage.createFromPath(photo);
    if (image.isEmpty()) return null;
    const square = image.resize({ width: SIZE, height: SIZE, quality: "best" });
    const round = nativeImage.createFromBitmap(circleMask(square.toBitmap(), SIZE), { width: SIZE, height: SIZE });
    await mkdir(outDir, { recursive: true });
    await writeFile(out, round.toPNG());
    return out;
  } catch {
    return null;
  }
}
```

`desktop/main.ts`:
- Imports: `import { roundAvatar } from "./avatar.ts";`
- Helper, perto de `iconPath`:

```ts
// A foto não pode atrasar o aviso: sem ela em 1,5 s, vai o ícone do app.
const AVATAR_WAIT = 1500;
async function chatIcon(jid: string): Promise<string> {
  if (!server) return iconPath();
  const photo = server.avatar(jid).then((p) => (p ? roundAvatar(p, join(app.getPath("userData"), "avatars-round")) : null));
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), AVATAR_WAIT));
  return (await Promise.race([photo, late]).catch(() => null)) ?? iconPath();
}
```

- `notify`: preserve os guards, o `flashFrame(true)`, as opções do toast e os handlers de `click`/`action`/`reply`/`close` da Tarefa 3. Mude só isto:
  1. `const count = counter.bump(chat.jid);` continua antes de qualquer `await`.
  2. Depois, `void chatIcon(chat.jid).then((icon) => { ... })`. O bloco que fecha o toast anterior, cria o `Notification` e liga os handlers vai para dentro do `then`, com `icon` no lugar de `iconPath()`.
  3. No começo do `then`, `if (counter.get(chat.jid) !== count) return;`. Uma mensagem mais nova, ou a conversa lida no meio da espera, descarta este toast. O título usa `count`.
- `remind`: troque `icon: iconPath()` pela foto. Envolva a criação em `void chatIcon(chat.jid).then((icon) => { ... })`, sem checar contador. O lembrete continua avisando no silêncio e em foco.

- [ ] **Passo 4: rodar e ver passar**: `node --test tests/avatar-mask.test.ts`, depois `pnpm typecheck` e `pnpm test`.

- [ ] **Passo 5: commit**: `feat(notificações): foto de perfil em círculo no toast`. No corpo, explicar o recorte por máscara BGRA (o Windows não arredonda o ícone sem `toastXml`), a espera máxima de 1,5 s com o ícone do app como alternativa e o descarte de toast obsoleto pelo contador.

---

### Tarefa 7: validação no app empacotado

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
- [ ] **Passo 10:** mensagem de contato com foto mostra a foto em círculo no toast; contato sem foto (ou privacidade) mostra o ícone do app; grupo com foto mostra a foto do grupo.
