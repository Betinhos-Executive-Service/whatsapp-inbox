// Ponte com o app desktop (preload). No navegador (pnpm dev) ela não existe.
import { useEffect, useState } from "react";
export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "latest"; checkedAt: number }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "installing"; version: string }
  | { status: "error"; version: string | null; message: string };

export type ReleaseInfo = { version: string; date: string; notes: string; current: boolean };

/** Conta desta página: cada conta do WhatsApp é uma instância separada do app. */
export type AccountInfo = { id: string; name: string; count: number; max: number; removable: boolean };

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
  onOpenChat: (cb: (jid: string) => void) => () => void;
  onOpenSettings: (cb: (tab?: string) => void) => () => void;
  accountInfo: () => Promise<AccountInfo | null>;
  renameAccount: (name: string) => Promise<AccountInfo | null>;
  addAccount: () => Promise<void>;
  onAccount: (cb: (info: AccountInfo) => void) => () => void;
};

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => window.desktop;

/** Conta desta página, atualizada quando o nome ou a quantidade de contas muda. */
export function useAccount(): AccountInfo | null {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let alive = true;
    void bridge.accountInfo().then((i) => alive && setInfo(i));
    const off = bridge.onAccount(setInfo);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return info;
}
