// Ponte com o app desktop (preload). No navegador (pnpm dev) ela não existe.
export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "latest"; checkedAt: number }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "installing"; version: string }
  | { status: "error"; version: string | null; message: string };

export type ReleaseInfo = { version: string; date: string; notes: string; current: boolean };

export type DesktopBridge = {
  listVersions: () => Promise<ReleaseInfo[]>;
  installVersion: (version: string) => Promise<UpdateState>;
  getUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<UpdateState>;
  checkUpdate: () => Promise<UpdateState>;
  appInfo: () => Promise<{ version: string; packaged: boolean } | null>;
  onUpdate: (cb: (s: UpdateState) => void) => () => void;
  onRemind: (cb: () => void) => () => void;
  setUnread: (total: number, image: string | null) => void;
  /** Põe o arquivo da mídia na área de transferência (colar no Explorer, e-mail etc.). */
  copyFile: (chatJid: string, id: string) => Promise<void>;
  /** Abre a mídia no app padrão do Windows, sem salvar em Downloads. */
  openFile: (chatJid: string, id: string) => Promise<void>;
  onOpenChat: (cb: (jid: string) => void) => () => void;
  onOpenSettings: (cb: () => void) => () => void;
};

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => window.desktop;
