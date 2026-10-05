// Processo principal do app desktop: sobe o servidor local dentro do próprio Electron,
// abre a janela nele e mantém tudo rodando na bandeja quando a janela é fechada.
import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, shell, Tray } from "electron";
import { join } from "node:path";
import { startApp, type RunningApp } from "../server/app.ts";
import type { Chat, Message, Reminder } from "../server/db.ts";
import { inQuietHours, type Prefs } from "../server/prefs.ts";
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
// Notificações vivas: sem referência, o Windows pode descartar o clique.
const shown = new Set<Notification>();

const iconPath = () => join(app.getAppPath(), "dist", "icon.ico");

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

function applyPrefs(prefs: Prefs) {
  // Empacotado só: em desenvolvimento registraria o electron.exe genérico.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: prefs.startWithWindows, args: prefs.startMinimized ? ["--hidden"] : [] });
}

function notify(chat: Chat, message: Message) {
  const prefs = server?.prefs();
  if (!prefs?.notifyEnabled || !Notification.isSupported()) return;
  // Com o app na frente a mensagem já aparece na tela.
  if (window?.isVisible() && window.isFocused()) return;
  if (inQuietHours(prefs)) return;
  const n = new Notification({
    title: chat.name,
    body: prefs.notifyPreview ? message.text.slice(0, 180) : "Nova mensagem",
    silent: !prefs.notifySound,
    icon: iconPath(),
  });
  shown.add(n);
  n.on("click", () => {
    showWindow();
    sendToPage("app:open-chat", chat.jid);
  });
  n.on("close", () => shown.delete(n));
  n.show();
  setTimeout(() => shown.delete(n), 60_000);
}

/** Lembrete é pedido explícito seu: avisa mesmo com o app na frente e no horário de silêncio. */
function remind(chat: Chat, reminder: Reminder) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: `Lembrete: ${chat.name}`,
    body: reminder.text || "Hora de retomar esta conversa.",
    silent: server ? !server.prefs().notifySound : false,
    icon: iconPath(),
  });
  shown.add(n);
  n.on("click", () => {
    showWindow();
    sendToPage("app:open-chat", chat.jid);
  });
  n.on("close", () => shown.delete(n));
  n.show();
}

function createWindow(url: string) {
  window = new BrowserWindow({
    title: PRODUCT,
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    show: false,
    backgroundColor: "#f0f0f0",
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
