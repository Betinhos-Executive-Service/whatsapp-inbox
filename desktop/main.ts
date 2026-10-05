// Processo principal do app desktop: sobe o servidor local dentro do próprio Electron,
// abre a janela nele e mantém tudo rodando na bandeja quando a janela é fechada.
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from "electron";
import { join } from "node:path";
import { startApp, type RunningApp } from "../server/app.ts";
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

const iconPath = () => join(app.getAppPath(), "dist", "icon.ico");

function showWindow() {
  if (!window) return;
  // Voltar ao app conta como "entrar": o aviso de versão nova aparece de novo.
  if (!window.isVisible()) updates?.remind();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
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
  const login = app.getLoginItemSettings({ args: ["--hidden"] });
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir ${PRODUCT}`, click: showWindow },
      { type: "separator" },
      {
        label: "Iniciar com o Windows",
        type: "checkbox",
        checked: login.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
          buildTrayMenu();
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
