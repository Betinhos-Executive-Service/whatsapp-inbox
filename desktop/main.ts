// Processo principal do app desktop: sobe um servidor local por conta de WhatsApp dentro do
// próprio Electron, mostra cada conta numa área própria da mesma janela e mantém tudo rodando
// na bandeja quando a janela é fechada. Cada conta é uma instância separada (dados, auth e
// configurações próprios); a troca de conta só alterna qual área aparece.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, shell, Tray, WebContentsView, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "../server/app.ts";
import type { Chat, Message, Reminder } from "../server/db.ts";
import { inQuietHours, type Prefs } from "../server/prefs.ts";
import type { ConnectionState } from "../server/whatsapp.ts";
import { addAccount, isRemovableDir, loadAccounts, MAX_ACCOUNTS, removeAccount, renameAccount, saveAccounts, setActive, type Account, type Registry } from "./accounts.ts";
import { roundAvatar } from "./avatar.ts";
import { mediaToTemp } from "./files.ts";
import { isUrgent, notificationBody, notificationTitle, UnreadCounter } from "./notifications.ts";
import type { RailAccount } from "./rail/rail.ts";
import { setupUpdates } from "./updates.ts";

const PRODUCT = "WhatsApp Inbox";
const RAIL_WIDTH = 72;
const startHidden = process.argv.includes("--hidden");

type Instance = {
  account: Account;
  view: WebContentsView;
  app: RunningApp | null;
  origin: string | null;
  connection: ConnectionState | null;
  error: string | null;
  unread: number;
};

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let registry: Registry;
const instances = new Map<string, Instance>();
let quitting = false;
let trayHintShown = false;
let updates: ReturnType<typeof setupUpdates> | null = null;
// Um toast vivo por conversa (chave conta:jid): sem referência, o Windows pode descartar o clique;
// com ela, a mensagem seguinte fecha a anterior e mostra o total.
const byChat = new Map<string, Notification>();
// Lembretes e toasts de erro: guardados só para o Windows não descartar clique nem ação.
const transient = new Set<Notification>();
const counter = new UnreadCounter();

const iconPath = () => join(app.getAppPath(), "dist", "icon.ico");
const userData = () => app.getPath("userData");
const chatKey = (inst: Instance, jid: string) => `${inst.account.id}:${jid}`;
const multiple = () => registry.accounts.length > 1;
const active = () => instances.get(registry.active) ?? null;
/** A primeira conta governa o que é do app inteiro: tema da janela e iniciar com o Windows. */
const isPrimary = (inst: Instance) => registry.accounts[0]?.id === inst.account.id;

// A foto não pode atrasar o aviso: sem ela em 1,5 s, vai o ícone do app.
const AVATAR_WAIT = 1500;
async function chatIcon(inst: Instance, jid: string): Promise<string> {
  if (!inst.app) return iconPath();
  const photo = inst.app.avatar(jid).then((p) => (p ? roundAvatar(p, join(userData(), "avatars-round")) : null));
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

/** Fundo da janela antes da interface carregar: igual ao canvas do tema. */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#0b1220" : "#f0f0f0");

function applyPrefs(prefs: Prefs) {
  // Barra de título e menus nativos seguem o tema escolhido no app.
  nativeTheme.themeSource = prefs.theme;
  for (const inst of instances.values()) inst.view.setBackgroundColor(windowBackground());
  // Empacotado só: em desenvolvimento registraria o electron.exe genérico.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: prefs.startWithWindows, args: prefs.startMinimized ? ["--hidden"] : [] });
}

// ---- contas: área de cada uma, trilho e troca

/** Trilho só com duas ou mais contas: com uma, a janela é igual à de antes. */
function layout() {
  if (!window) return;
  const [width, height] = window.getContentSize();
  const rail = multiple() ? RAIL_WIDTH : 0;
  for (const inst of instances.values()) {
    inst.view.setBounds({ x: rail, y: 0, width: Math.max(width - rail, 0), height });
    inst.view.setVisible(inst.account.id === registry.active);
  }
}

function statusOf(inst: Instance): Pick<RailAccount, "status" | "statusText"> {
  if (inst.error) return { status: "error", statusText: "Falha ao iniciar" };
  switch (inst.connection?.status) {
    case "conectado":
      return { status: "ok", statusText: inst.connection.me ? `Conectado · +${inst.connection.me.split("@")[0]}` : "Conectado" };
    case "qr":
      return { status: "qr", statusText: "Aguardando leitura do QR" };
    case "desconectado":
      return { status: "error", statusText: "Desconectado" };
    case "reconectando":
      return { status: "wait", statusText: "Reconectando" };
    default:
      return { status: "wait", statusText: "Iniciando" };
  }
}

function pushRail() {
  if (!window) return;
  const accounts: RailAccount[] = registry.accounts.flatMap((account) => {
    const inst = instances.get(account.id);
    return inst ? [{ id: account.id, name: account.name, active: account.id === registry.active, unread: inst.unread, ...statusOf(inst) }] : [];
  });
  window.webContents.send("rail:state", accounts);
  buildTrayMenu();
}

/** Contas mudaram (nome, quantidade): avisa a página de cada uma. */
function pushAccounts() {
  for (const inst of instances.values()) inst.view.webContents.send("app:account", accountInfo(inst));
}

function accountInfo(inst: Instance) {
  return { id: inst.account.id, name: inst.account.name, count: registry.accounts.length, max: MAX_ACCOUNTS, removable: isRemovableDir(userData(), inst.account) };
}

function persist(next: Registry) {
  registry = next;
  saveAccounts(userData(), registry);
}

function activate(id: string) {
  const inst = instances.get(id);
  if (!inst) return;
  if (registry.active !== id) persist(setActive(registry, id));
  layout();
  pushRail();
  inst.view.webContents.focus();
}

/** Página de erro de uma conta que não subiu; as outras continuam funcionando. */
function errorPage(message: string) {
  const html = `<!doctype html><meta charset="utf-8"><body style="font:15px 'Segoe UI',sans-serif;color:#0f172a;background:#f0f0f0;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px"><strong>Não foi possível iniciar esta conta.</strong><p style="color:#64748b">${message.replace(/[<>&]/g, "")}</p><p style="color:#64748b">Feche e abra o app de novo. Se continuar, remova a conta pelo clique direito no trilho.</p></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function startInstance(account: Account): Promise<Instance> {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      preload: join(app.getAppPath(), "dist-electron", "preload.cjs"),
    },
  });
  view.setBackgroundColor(windowBackground());
  const inst: Instance = { account, view, app: null, origin: null, connection: null, error: null, unread: 0 };
  instances.set(account.id, inst);
  // Cada área só mostra o app local da sua conta; qualquer outro endereço abre no navegador padrão.
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  view.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== inst.origin) {
      event.preventDefault();
      if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    }
  });
  window?.contentView.addChildView(view);
  layout();
  try {
    inst.app = await startApp({
      port: 0,
      dataDir: account.dataDir,
      distDir: join(app.getAppPath(), "dist"),
      onIncoming: (chat, message) => notify(inst, chat, message),
      onReminder: (chat, reminder) => remind(inst, chat, reminder),
      onPrefs: (prefs) => {
        if (isPrimary(inst)) applyPrefs(prefs);
      },
      onRead: (jid) => clearChat(inst, jid),
      onConnection: (state) => {
        inst.connection = state;
        if (state.status === "conectado") warnDuplicate(inst);
        pushRail();
      },
    });
    inst.connection = inst.app.connection();
    inst.origin = `http://127.0.0.1:${inst.app.port}`;
    void view.webContents.loadURL(inst.origin);
  } catch (error) {
    inst.error = error instanceof Error ? error.message : String(error);
    console.error(`Conta ${account.name} não iniciou:`, error);
    void view.webContents.loadURL(errorPage(inst.error));
  }
  pushRail();
  return inst;
}

/** O mesmo número em duas contas faz o WhatsApp derrubar uma delas: avisa logo. */
function warnDuplicate(inst: Instance) {
  const me = inst.connection?.me?.split(/[:@]/)[0];
  if (!me) return;
  const other = [...instances.values()].find((o) => o !== inst && o.connection?.status === "conectado" && o.connection.me?.split(/[:@]/)[0] === me);
  if (!other || !window) return;
  void dialog.showMessageBox(window, {
    type: "warning",
    title: PRODUCT,
    message: `O número +${me} já está na conta "${other.account.name}".`,
    detail: `Remova a conta "${inst.account.name}" ou conecte outro número nela; o mesmo número em duas contas fica caindo.`,
  });
}

async function addNewAccount() {
  if (!window) return;
  if (registry.accounts.length >= MAX_ACCOUNTS) {
    void dialog.showMessageBox(window, { type: "info", title: PRODUCT, message: `O limite é de ${MAX_ACCOUNTS} contas.` });
    return;
  }
  showWindow();
  const source = active();
  let copy = false;
  if (source?.app) {
    const answer = await dialog.showMessageBox(window, {
      type: "question",
      title: "Adicionar conta",
      message: "Adicionar outra conta do WhatsApp",
      detail: `A conta nova é separada: conversas, número e configurações próprios.\n\nQuer começar com as configurações de "${source.account.name}" (chaves de IA, etiquetas, respostas rápidas e preferências)? As conversas nunca são copiadas.`,
      buttons: ["Copiar configurações", "Começar do zero", "Cancelar"],
      defaultId: 0,
      cancelId: 2,
    });
    if (answer.response === 2) return;
    copy = answer.response === 0;
  }
  const { registry: next, account } = addAccount(userData(), registry, "");
  persist(next);
  const inst = await startInstance(account);
  if (copy && source?.app && inst.app) {
    try {
      inst.app.importSettings(source.app.exportSettings());
    } catch (error) {
      console.error("Falha ao copiar configurações:", error);
    }
  }
  activate(account.id);
  pushAccounts();
}

function renameCurrent(inst: Instance, name: string) {
  persist(renameAccount(registry, inst.account.id, name));
  inst.account = registry.accounts.find((a) => a.id === inst.account.id) ?? inst.account;
  pushRail();
  pushAccounts();
}

async function removeExisting(id: string) {
  const inst = instances.get(id);
  if (!inst || !window) return;
  if (!isRemovableDir(userData(), inst.account) || registry.accounts.length <= 1) {
    void dialog.showMessageBox(window, {
      type: "info",
      title: PRODUCT,
      message: "A conta principal não pode ser removida.",
      detail: "Para usar outro número nela, abra Configurações → Conta → Trocar de número.",
    });
    return;
  }
  const answer = await dialog.showMessageBox(window, {
    type: "warning",
    title: "Remover conta",
    message: `Remover a conta "${inst.account.name}"?`,
    detail: "O WhatsApp desta conta é desconectado e as conversas, configurações e mídias dela são apagadas deste computador. As outras contas não mudam.",
    buttons: ["Remover conta", "Cancelar"],
    defaultId: 1,
    cancelId: 1,
  });
  if (answer.response !== 0) return;
  persist(removeAccount(registry, id));
  instances.delete(id);
  window.contentView.removeChildView(inst.view);
  inst.view.webContents.close();
  for (const key of [...byChat.keys()]) if (key.startsWith(`${id}:`)) clearChatKey(key);
  try {
    await inst.app?.logout().catch(() => undefined);
    await inst.app?.close();
    await rm(inst.account.dataDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Falha ao apagar os dados da conta removida:", error);
  }
  activate(registry.active);
  pushAccounts();
  updateUnread();
}

function accountMenu(id: string) {
  const inst = instances.get(id);
  if (!inst || !window) return;
  Menu.buildFromTemplate([
    { label: `Abrir ${inst.account.name}`, click: () => activate(id) },
    {
      label: "Renomear…",
      click: () => {
        activate(id);
        inst.view.webContents.send("app:open-settings", "conta");
      },
    },
    { type: "separator" },
    { label: "Remover conta…", enabled: isRemovableDir(userData(), inst.account), click: () => void removeExisting(id) },
  ]).popup({ window });
}

// ---- notificações (por conta)

/**
 * No Windows o `close` também dispara quando o toast expira e vai para a Central de Ações.
 * Só o dispensar do usuário solta a referência; expirado segue guardado, para a resposta ou
 * a ação feita depois pela Central funcionar e para `close()` ainda poder limpá-lo.
 */
function released(event: Electron.Event<Electron.NotificationCloseEventParams>) {
  return event.reason === "userCanceled";
}

function clearChatKey(key: string) {
  counter.clear(key);
  // No Windows é este close() no objeto guardado que tira o toast da Central de Ações.
  byChat.get(key)?.close();
  byChat.delete(key);
  // Só vale no macOS (no Windows não faz nada).
  Notification.removeGroup(key);
}

/** Conversa vista ou lida: some o toast e a contagem recomeça. */
function clearChat(inst: Instance, jid: string) {
  clearChatKey(chatKey(inst, jid));
}

function openChat(inst: Instance, jid: string) {
  activate(inst.account.id);
  showWindow();
  inst.view.webContents.send("app:open-chat", jid);
  clearChat(inst, jid);
}

/** Com mais de uma conta, o toast diz de qual conta veio. */
const withAccount = (inst: Instance, title: string) => (multiple() ? `${inst.account.name} · ${title}` : title);

function failure(inst: Instance, chat: Chat, title: string, detail: string) {
  const key = chatKey(inst, chat.jid);
  const n = new Notification({ title: withAccount(inst, title), body: detail.slice(0, 180), icon: iconPath(), groupId: key, groupTitle: chat.name });
  transient.add(n);
  n.on("click", () => openChat(inst, chat.jid));
  n.on("close", (event) => {
    if (released(event)) transient.delete(n);
  });
  n.show();
}

function notify(inst: Instance, chat: Chat, message: Message) {
  const prefs = inst.app?.prefs();
  if (!prefs?.notifyEnabled || !Notification.isSupported()) return;
  // Com a conta na frente a mensagem já aparece na tela.
  if (window?.isVisible() && window.isFocused() && registry.active === inst.account.id) return;
  if (inQuietHours(prefs)) return;
  window?.flashFrame(true);
  const key = chatKey(inst, chat.jid);
  const count = counter.bump(key);
  void chatIcon(inst, chat.jid).then((icon) => {
    // Mensagem mais nova, ou conversa lida durante a espera: este toast ficou obsoleto.
    if (counter.get(key) !== count) return;
    byChat.get(key)?.close();
    const n = new Notification({
      id: key,
      groupId: key,
      // Sem groupTitle: o Windows repetiria o nome da conversa acima do título.
      title: withAccount(inst, notificationTitle(chat, count)),
      body: notificationBody(message, prefs.notifyPreview),
      silent: !prefs.notifySound,
      urgency: isUrgent(chat) ? "critical" : "normal",
      icon,
      hasReply: true,
      replyPlaceholder: "Responder…",
      actions: [{ type: "button", text: "Marcar como lida" }],
    });
    byChat.set(key, n);
    n.on("click", () => openChat(inst, chat.jid));
    n.on("action", () => {
      inst.app?.markRead(chat.jid).catch((e: Error) => failure(inst, chat, `Não foi possível marcar ${chat.name} como lida`, e.message));
    });
    n.on("reply", (event) => {
      const text = event.reply.trim();
      if (!text || !inst.app) return;
      inst.app
        .send(chat.jid, text)
        .then(
          // Enviou: falha só no markRead não vira "não enviada".
          () => inst.app?.markRead(chat.jid).catch((e: Error) => console.error("Falha ao marcar como lida após responder:", e)),
          (e: Error) => failure(inst, chat, `Mensagem não enviada para ${chat.name}`, `${e.message} Texto: ${text}`),
        );
    });
    n.on("close", (event) => {
      if (released(event) && byChat.get(key) === n) byChat.delete(key);
    });
    n.show();
  }).catch((e: Error) => console.error("Falha ao mostrar a notificação:", e));
}

/** Lembrete é pedido explícito seu: avisa mesmo com o app na frente e no horário de silêncio. */
function remind(inst: Instance, chat: Chat, reminder: Reminder) {
  if (!Notification.isSupported()) return;
  void chatIcon(inst, chat.jid).then((icon) => {
    const key = chatKey(inst, chat.jid);
    const n = new Notification({
      title: withAccount(inst, `Lembrete: ${chat.name}`),
      body: reminder.text || "Hora de retomar esta conversa.",
      silent: inst.app ? !inst.app.prefs().notifySound : false,
      icon,
      groupId: key,
      groupTitle: chat.name,
    });
    transient.add(n);
    n.on("click", () => openChat(inst, chat.jid));
    n.on("close", (event) => {
      if (released(event)) transient.delete(n);
    });
    n.show();
  }).catch((e: Error) => console.error("Falha ao mostrar o lembrete:", e));
}

// ---- não lidas: soma de todas as contas no ícone da barra de tarefas e na bandeja

let unreadDraw = 0;
function updateUnread() {
  const total = [...instances.values()].reduce((sum, inst) => sum + inst.unread, 0);
  tray?.setToolTip(total > 0 ? `${PRODUCT} — ${total} não lidas` : PRODUCT);
  pushRail();
  const draw = ++unreadDraw;
  if (total <= 0) {
    window?.setOverlayIcon(null, "");
    return;
  }
  // O selo é desenhado pelo trilho (mesmo desenho da página), com o total de todas as contas.
  void window?.webContents
    .executeJavaScript(`window.railBadge(${total})`)
    .then((png: unknown) => {
      if (draw !== unreadDraw || typeof png !== "string" || !png.startsWith("data:image/png;base64,")) return;
      window?.setOverlayIcon(nativeImage.createFromDataURL(png), `${total} não lidas`);
    })
    .catch(() => undefined);
}

// ---- IPC: só a página de uma conta (ou o trilho) fala com o processo principal

function senderInstance(event: IpcMainEvent | IpcMainInvokeEvent): Instance | null {
  for (const inst of instances.values()) {
    if (inst.view.webContents !== event.sender || !inst.origin) continue;
    return new URL(event.senderFrame?.url ?? "about:blank").origin === inst.origin ? inst : null;
  }
  return null;
}

const fromRail = (sender: WebContents) => !!window && sender === window.webContents;

function sendToAll(channel: string, ...args: unknown[]) {
  for (const inst of instances.values()) inst.view.webContents.send(channel, ...args);
}

function setupIpc() {
  ipcMain.on("app:unread", (event, total: unknown) => {
    const inst = senderInstance(event);
    if (!inst) return;
    inst.unread = Number.isInteger(total) && (total as number) >= 0 ? (total as number) : 0;
    updateUnread();
  });
  // Mídia como arquivo: copiar para colar em outro app, ou abrir no app padrão sem ir para Downloads.
  const mediaFile = (event: IpcMainInvokeEvent, chatJid: unknown, id: unknown) => {
    const inst = senderInstance(event);
    if (!inst?.origin) throw new Error("Origem não autorizada.");
    if (typeof chatJid !== "string" || typeof id !== "string" || !chatJid || !id) throw new Error("Mensagem inválida.");
    return mediaToTemp(inst.origin, chatJid, id, join(app.getPath("temp"), PRODUCT, inst.account.id));
  };
  ipcMain.handle("media:copy-file", async (event, chatJid: unknown, id: unknown) => {
    const path = await mediaFile(event, chatJid, id);
    if (process.platform !== "win32") throw new Error("Copiar arquivo só está disponível no Windows.");
    await copyFileToClipboard(path);
  });
  ipcMain.handle("media:open", async (event, chatJid: unknown, id: unknown) => {
    const failure = await shell.openPath(await mediaFile(event, chatJid, id));
    if (failure) throw new Error(`Nenhum app abriu este arquivo. ${failure}`);
  });
  ipcMain.handle("account:info", (event) => {
    const inst = senderInstance(event);
    return inst ? accountInfo(inst) : null;
  });
  ipcMain.handle("account:rename", (event, name: unknown) => {
    const inst = senderInstance(event);
    if (!inst || typeof name !== "string") return null;
    renameCurrent(inst, name);
    return accountInfo(inst);
  });
  ipcMain.handle("account:add", (event) => {
    if (senderInstance(event)) void addNewAccount();
  });
  ipcMain.on("rail:ready", (event) => {
    if (fromRail(event.sender)) pushRail();
  });
  ipcMain.on("rail:select", (event, id: unknown) => {
    if (fromRail(event.sender) && typeof id === "string") activate(id);
  });
  ipcMain.on("rail:menu", (event, id: unknown) => {
    if (fromRail(event.sender) && typeof id === "string") accountMenu(id);
  });
  ipcMain.on("rail:add", (event) => {
    if (fromRail(event.sender)) void addNewAccount();
  });
}

// ---- janela e bandeja

function createWindow() {
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
      preload: join(app.getAppPath(), "dist-electron", "rail-preload.cjs"),
    },
  });
  // A página da janela é só o trilho de contas: nada de navegar nem abrir outras janelas.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    if (!startHidden) window?.show();
  });
  window.on("focus", () => {
    window?.flashFrame(false);
    active()?.view.webContents.focus();
  });
  window.on("resize", layout);
  // Ctrl+1…9 troca de conta, de qualquer lugar da janela.
  const shortcuts = (wc: WebContents) =>
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.control || input.alt || input.shift || !/^[1-9]$/.test(input.key)) return;
      const account = registry.accounts[Number(input.key) - 1];
      if (!account || !multiple()) return;
      event.preventDefault();
      activate(account.id);
    });
  shortcuts(window.webContents);
  app.on("web-contents-created", (_event, wc) => shortcuts(wc));
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
  void window.loadFile(join(app.getAppPath(), "dist", "rail", "index.html"));
}

/**
 * Lista de arquivos (CF_HDROP) na área de transferência do Windows, a mesma do Ctrl+C no Explorer.
 * O Electron só grava texto e imagem; o caminho vai por variável de ambiente, nunca no comando.
 */
function copyFileToClipboard(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:INBOX_CLIPBOARD_FILE"], {
      env: { ...process.env, INBOX_CLIPBOARD_FILE: path },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Não foi possível copiar o arquivo. ${stderr.trim()}`.trim()))));
  });
}

function buildTrayMenu() {
  if (!tray) return;
  const accounts: Electron.MenuItemConstructorOptions[] = multiple()
    ? [
        ...registry.accounts.map((account) => {
          const unread = instances.get(account.id)?.unread ?? 0;
          return {
            label: unread > 0 ? `${account.name} (${unread})` : account.name,
            type: "radio" as const,
            checked: account.id === registry.active,
            click: () => {
              activate(account.id);
              showWindow();
            },
          };
        }),
        { type: "separator" },
      ]
    : [];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir ${PRODUCT}`, click: showWindow },
      { type: "separator" },
      ...accounts,
      {
        label: "Configurações",
        click: () => {
          showWindow();
          active()?.view.webContents.send("app:open-settings");
        },
      },
      { label: "Adicionar conta do WhatsApp…", enabled: registry.accounts.length < MAX_ACCOUNTS, click: () => void addNewAccount() },
      { type: "separator" },
      { label: "Sair", click: () => app.quit() },
    ]),
  );
}

async function closeAll() {
  const running = [...instances.values()].map((inst) => inst.app).filter((a): a is RunningApp => !!a);
  for (const inst of instances.values()) inst.app = null;
  await Promise.all(running.map((a) => a.close().catch((e: Error) => console.error("Falha ao encerrar uma conta:", e))));
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
  let closing = false;
  app.on("will-quit", (event) => {
    if (closing || ![...instances.values()].some((inst) => inst.app)) return;
    closing = true;
    event.preventDefault();
    void closeAll().finally(() => app.exit(0));
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      registry = loadAccounts(userData());
    } catch (error) {
      dialog.showErrorBox(PRODUCT, `Não foi possível ler as contas.\n\n${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
      return;
    }
    setupIpc();
    createWindow();
    tray = new Tray(nativeImage.createFromPath(iconPath()));
    tray.setToolTip(PRODUCT);
    tray.on("click", showWindow);
    buildTrayMenu();
    await Promise.all(registry.accounts.map((account) => startInstance(account)));
    if (![...instances.values()].some((inst) => inst.app)) {
      const first = instances.values().next().value;
      dialog.showErrorBox(PRODUCT, `Não foi possível iniciar o app.\n\n${first?.error ?? ""}`);
      app.exit(1);
      return;
    }
    activate(registry.active);
    updates = setupUpdates({
      send: sendToAll,
      trusted: (event) => !!senderInstance(event),
      beforeInstall: async () => {
        quitting = true;
        closing = true;
        await closeAll();
      },
    });
  });
}
