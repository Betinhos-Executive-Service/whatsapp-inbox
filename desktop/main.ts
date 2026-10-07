// Processo principal do app desktop: sobe o servidor local dentro do próprio Electron,
// abre a janela nele e mantém tudo rodando na bandeja quando a janela é fechada.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, shell, Tray } from "electron";
import { join } from "node:path";
import { startApp, type RunningApp } from "../server/app.ts";
import type { Chat, Message, Reminder } from "../server/db.ts";
import { inQuietHours, type Prefs } from "../server/prefs.ts";
import { roundAvatar } from "./avatar.ts";
import { isUrgent, notificationBody, notificationTitle, UnreadCounter } from "./notifications.ts";
import { setupUpdates } from "./updates.ts";

const PRODUCT = "WhatsApp Inbox";
const startHidden = process.argv.includes("--hidden");
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: RunningApp | null = null;
let quitting = false;
let trayHintShown = false;
let origin: string | null = null;
let updates: ReturnType<typeof setupUpdates> | null = null;
// Um toast vivo por conversa: sem referência, o Windows pode descartar o clique;
// com ela, a mensagem seguinte fecha a anterior e mostra o total.
const byChat = new Map<string, Notification>();
// Lembretes e toasts de erro: guardados só para o Windows não descartar clique nem ação.
const transient = new Set<Notification>();
const counter = new UnreadCounter();

const iconPath = () => join(app.getAppPath(), "dist", "icon.ico");

// A foto não pode atrasar o aviso: sem ela em 1,5 s, vai o ícone do app.
const AVATAR_WAIT = 1500;
async function chatIcon(jid: string): Promise<string> {
  if (!server) return iconPath();
  const photo = server.avatar(jid).then((p) => (p ? roundAvatar(p, join(app.getPath("userData"), "avatars-round")) : null));
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), AVATAR_WAIT));
  return (await Promise.race([photo, late]).catch(() => null)) ?? iconPath();
}

function showWindow() {
  if (!window) return;
  // Voltar ao app conta como "entrar": o aviso de versão nova aparece de novo.
  if (!window.isVisible()) updates?.remind();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function sendToPage(channel: string, ...args: unknown[]) {
  window?.webContents.send(channel, ...args);
}

/** Fundo da janela antes da interface carregar: igual ao canvas do tema. */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#0b1220" : "#f0f0f0");

function applyPrefs(prefs: Prefs) {
  // Barra de título e menus nativos seguem o tema escolhido no app.
  nativeTheme.themeSource = prefs.theme;
  window?.setBackgroundColor(windowBackground());
  // Empacotado só: em desenvolvimento registraria o electron.exe genérico.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: prefs.startWithWindows, args: prefs.startMinimized ? ["--hidden"] : [] });
}

/**
 * No Windows o `close` também dispara quando o toast expira e vai para a Central de Ações.
 * Só o dispensar do usuário solta a referência; expirado segue guardado, para a resposta ou
 * a ação feita depois pela Central funcionar e para `close()` ainda poder limpá-lo.
 */
function released(event: Electron.Event<Electron.NotificationCloseEventParams>) {
  return event.reason === "userCanceled";
}

/** Conversa vista ou lida: some o toast e a contagem recomeça. */
function clearChat(jid: string) {
  counter.clear(jid);
  // No Windows é este close() no objeto guardado que tira o toast da Central de Ações.
  byChat.get(jid)?.close();
  byChat.delete(jid);
  // Só vale no macOS (no Windows não faz nada).
  Notification.removeGroup(jid);
}

function openChat(jid: string) {
  showWindow();
  sendToPage("app:open-chat", jid);
  clearChat(jid);
}

function failure(chat: Chat, title: string, detail: string) {
  const n = new Notification({ title, body: detail.slice(0, 180), icon: iconPath(), groupId: chat.jid, groupTitle: chat.name });
  transient.add(n);
  n.on("click", () => openChat(chat.jid));
  n.on("close", (event) => {
    if (released(event)) transient.delete(n);
  });
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
  void chatIcon(chat.jid).then((icon) => {
    // Mensagem mais nova, ou conversa lida durante a espera: este toast ficou obsoleto.
    if (counter.get(chat.jid) !== count) return;
    byChat.get(chat.jid)?.close();
    const n = new Notification({
      id: chat.jid,
      groupId: chat.jid,
      groupTitle: chat.name,
      title: notificationTitle(chat, count),
      body: notificationBody(message, prefs.notifyPreview),
      silent: !prefs.notifySound,
      urgency: isUrgent(chat) ? "critical" : "normal",
      icon,
      hasReply: true,
      replyPlaceholder: "Responder…",
      actions: [{ type: "button", text: "Marcar como lida" }],
    });
    byChat.set(chat.jid, n);
    n.on("click", () => openChat(chat.jid));
    n.on("action", () => {
      server?.markRead(chat.jid).catch((e: Error) => failure(chat, `Não foi possível marcar ${chat.name} como lida`, e.message));
    });
    n.on("reply", (event) => {
      const text = event.reply.trim();
      if (!text || !server) return;
      server
        .send(chat.jid, text)
        .then(
          // Enviou: falha só no markRead não vira "não enviada".
          () => server?.markRead(chat.jid).catch((e: Error) => console.error("Falha ao marcar como lida após responder:", e)),
          (e: Error) => failure(chat, `Mensagem não enviada para ${chat.name}`, `${e.message} Texto: ${text}`),
        );
    });
    n.on("close", (event) => {
      if (released(event) && byChat.get(chat.jid) === n) byChat.delete(chat.jid);
    });
    n.show();
  }).catch((e: Error) => console.error("Falha ao mostrar a notificação:", e));
}

/** Lembrete é pedido explícito seu: avisa mesmo com o app na frente e no horário de silêncio. */
function remind(chat: Chat, reminder: Reminder) {
  if (!Notification.isSupported()) return;
  void chatIcon(chat.jid).then((icon) => {
    const n = new Notification({
      title: `Lembrete: ${chat.name}`,
      body: reminder.text || "Hora de retomar esta conversa.",
      silent: server ? !server.prefs().notifySound : false,
      icon,
      groupId: chat.jid,
      groupTitle: chat.name,
    });
    transient.add(n);
    n.on("click", () => openChat(chat.jid));
    n.on("close", (event) => {
      if (released(event)) transient.delete(n);
    });
    n.show();
  }).catch((e: Error) => console.error("Falha ao mostrar o lembrete:", e));
}

function createWindow(url: string) {
  window = new BrowserWindow({
    title: PRODUCT,
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    show: false,
    backgroundColor: windowBackground(),
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      preload: join(app.getAppPath(), "dist-electron", "preload.cjs"),
    },
  });
  origin = new URL(url).origin;
  // A janela só mostra o app local; qualquer outro endereço abre no navegador padrão.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== origin) {
      event.preventDefault();
      if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    }
  });
  window.once("ready-to-show", () => {
    if (!startHidden) window?.show();
  });
  window.on("focus", () => window?.flashFrame(false));
  // Fechar a janela só esconde: o WhatsApp continua recebendo e o Jev classificando.
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
    if (!trayHintShown && tray) {
      trayHintShown = true;
      tray.displayBalloon({
        iconType: "info",
        title: PRODUCT,
        content: "Continua aberto aqui na bandeja, recebendo mensagens. Para sair, use Sair no menu do ícone.",
      });
    }
  });
  void window.loadURL(url);
}

function buildTrayMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir ${PRODUCT}`, click: showWindow },
      {
        label: "Configurações",
        click: () => {
          showWindow();
          sendToPage("app:open-settings");
        },
      },
      { type: "separator" },
      { label: "Sair", click: () => app.quit() },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("br.com.betinhos.whatsapp-inbox");
  app.on("second-instance", showWindow);
  app.on("window-all-closed", () => {
    // Fica na bandeja: não encerra quando a janela some.
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", (event) => {
    if (!server) return;
    event.preventDefault();
    const running = server;
    server = null;
    void running.close().finally(() => app.exit(0));
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      server = await startApp({
        port: 0,
        dataDir: join(app.getPath("userData"), "data"),
        distDir: join(app.getAppPath(), "dist"),
        onIncoming: notify,
        onReminder: remind,
        onPrefs: applyPrefs,
        onRead: clearChat,
      });
    } catch (error) {
      dialog.showErrorBox(PRODUCT, `Não foi possível iniciar o app.\n\n${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
      return;
    }
    tray = new Tray(nativeImage.createFromPath(iconPath()));
    tray.setToolTip(PRODUCT);
    tray.on("click", showWindow);
    buildTrayMenu();
    // Contador vindo da página: só aceita número inteiro e PNG em data URL.
    ipcMain.on("app:unread", (event, total: unknown, image: unknown) => {
      if (!origin || new URL(event.senderFrame?.url ?? "about:blank").origin !== origin) return;
      const n = Number.isInteger(total) && (total as number) >= 0 ? (total as number) : 0;
      const png = typeof image === "string" && image.startsWith("data:image/png;base64,") ? image : null;
      window?.setOverlayIcon(n > 0 && png ? nativeImage.createFromDataURL(png) : null, n > 0 ? `${n} não lidas` : "");
      tray?.setToolTip(n > 0 ? `${PRODUCT} — ${n} não lidas` : PRODUCT);
    });
    createWindow(`http://127.0.0.1:${server.port}`);
    updates = setupUpdates({
      window: () => window,
      trustedOrigin: () => origin,
      beforeInstall: async () => {
        quitting = true;
        const running = server;
        server = null;
        await running?.close();
      },
    });
  });
}
