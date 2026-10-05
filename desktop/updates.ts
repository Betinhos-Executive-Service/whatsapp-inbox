// Atualização pelo GitHub Releases (Betinhos-Executive-Service/whatsapp-inbox).
// Só consulta e baixa quando a pessoa pede: a janela mostra o aviso e o botão "Atualizar agora".
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import updater from "electron-updater";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "latest"; checkedAt: number }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "installing"; version: string }
  | { status: "error"; version: string | null; message: string };

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const OWNER = "Betinhos-Executive-Service";
const REPO = "whatsapp-inbox";
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

export function setupUpdates(options: {
  window: () => BrowserWindow | null;
  trustedOrigin: () => string | null;
  beforeInstall: () => Promise<void>;
}) {
  const { autoUpdater } = updater;
  let state: UpdateState = { status: "idle" };
  let latest: string | null = null;

  const publish = () => options.window()?.webContents.send("update:state", state);
  const set = (next: UpdateState) => {
    state = next;
    publish();
  };

  /** Só a página do próprio app (servidor local) pode pedir atualização. */
  const trusted = (event: IpcMainInvokeEvent) => {
    const origin = options.trustedOrigin();
    return !!origin && new URL(event.senderFrame?.url ?? "about:blank").origin === origin;
  };

  // Log em %APPDATA%WhatsApp Inboxlogsatualizacao.log: mostra onde uma atualização parou.
  const logDir = join(app.getPath("userData"), "logs");
  const write = (level: string) => (...args: unknown[]) => {
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(join(logDir, "atualizacao.log"), `${new Date().toISOString()} [${level}] ${args.map(String).join(" ")}
`);
    } catch {
      // log é diagnóstico; nunca derruba a atualização
    }
  };
  autoUpdater.logger = { info: write("info"), warn: write("warn"), error: write("error"), debug: () => undefined };
  autoUpdater.autoDownload = false;
  // Se algo impedir a instalação imediata, a versão baixada instala ao sair do app.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    latest = info.version;
    if (!["downloading", "installing"].includes(state.status)) set({ status: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    if (state.status === "checking" || state.status === "idle") set({ status: "latest", checkedAt: Date.now() });
  });
  autoUpdater.on("download-progress", (p) => {
    if (latest) set({ status: "downloading", version: latest, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    set({ status: "installing", version: info.version });
    write("info")(`Baixada v${info.version}; encerrando o app para instalar.`);
    // Nunca deixa a instalação esperando o encerramento para sempre.
    await Promise.race([options.beforeInstall().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
    // Silencioso e reabre o app sozinho depois de instalar.
    write("info")("Chamando quitAndInstall.");
    autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on("error", (error) => {
    // Falha de consulta sem aviso aberto não incomoda ninguém; falha no download aparece.
    if (state.status === "checking") set({ status: "error", version: null, message: error?.message ?? String(error) });
    else if (state.status === "downloading" || state.status === "available") {
      set({ status: "error", version: latest, message: error?.message ?? String(error) });
    }
  });

  const check = () => {
    if (!app.isPackaged) return;
    autoUpdater.checkForUpdates().catch(() => undefined);
  };

  ipcMain.handle("update:get", (event) => (trusted(event) ? state : { status: "idle" }));
  ipcMain.handle("app:info", (event) => (trusted(event) ? { version: app.getVersion(), packaged: app.isPackaged } : null));
  // "Verificar atualização" nas Configurações: responde com o estado depois da consulta.
  ipcMain.handle("update:check", async (event) => {
    if (!trusted(event)) return state;
    if (!app.isPackaged) return { status: "error", version: null, message: "Atualização só funciona no app instalado." };
    if (state.status === "downloading" || state.status === "installing") return state;
    set({ status: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      set({ status: "error", version: null, message: error instanceof Error ? error.message : String(error) });
    }
    return state;
  });
  ipcMain.handle("update:install", async (event) => {
    if (!trusted(event) || !latest) return state;
    if (state.status === "downloading" || state.status === "installing") return state;
    set({ status: "downloading", version: latest, percent: 0 });
    autoUpdater.downloadUpdate().catch((error: unknown) =>
      set({ status: "error", version: latest, message: error instanceof Error ? error.message : String(error) }),
    );
    return state;
  });

  // ---- escolher a versão: lista as releases publicadas e instala a escolhida (mais nova ou mais antiga)

  ipcMain.handle("update:list", async (event) => {
    if (!trusted(event)) return [];
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "whatsapp-inbox" },
    });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}.`);
    const releases = (await res.json()) as { tag_name: string; draft: boolean; prerelease: boolean; published_at: string; body: string | null }[];
    return releases
      .filter((r) => !r.draft && !r.prerelease && VERSION.test(r.tag_name.replace(/^v/, "")))
      .map((r) => ({ version: r.tag_name.replace(/^v/, ""), date: r.published_at, notes: r.body ?? "", current: r.tag_name.replace(/^v/, "") === app.getVersion() }));
  });

  ipcMain.handle("update:install-version", async (event, version: unknown) => {
    if (!trusted(event) || typeof version !== "string" || !VERSION.test(version)) return state;
    if (!app.isPackaged) return { status: "error", version, message: "Instalar versões só funciona no app instalado." };
    if (state.status === "downloading" || state.status === "installing" || version === app.getVersion()) return state;
    // Cada release tem o seu latest.yml: apontar o feed para ela instala exatamente essa versão.
    autoUpdater.setFeedURL({ provider: "generic", url: `https://github.com/${OWNER}/${REPO}/releases/download/v${version}` });
    autoUpdater.allowDowngrade = true;
    latest = version;
    set({ status: "downloading", version, percent: 0 });
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo.version !== version) throw new Error(`A release v${version} não tem instalador válido.`);
      set({ status: "downloading", version, percent: 0 });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      autoUpdater.setFeedURL({ provider: "github", owner: OWNER, repo: REPO });
      autoUpdater.allowDowngrade = false;
      set({ status: "error", version, message: error instanceof Error ? error.message : String(error) });
    }
    return state;
  });

  check();
  setInterval(check, CHECK_EVERY_MS).unref();

  return {
    /** Ao reabrir a janela: consulta de novo e lembra a página de mostrar o aviso. */
    remind: () => {
      check();
      options.window()?.webContents.send("update:remind");
    },
  };
}
