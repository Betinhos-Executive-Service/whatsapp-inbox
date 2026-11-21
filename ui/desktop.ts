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
  /** Põe o arquivo da mídia na área de transferência (colar no Explorer, e-mail etc.). */
  copyFile: (chatJid: string, id: string) => Promise<void>;
  /** Põe a imagem na área de transferência pelo sistema (cola em qualquer app); false se o formato não é suportado. Ausente em versões antigas. */
  copyImage?: (chatJid: string, id: string) => Promise<boolean>;
  /** Abre a mídia no app padrão do computador, sem salvar em Downloads. */
  openFile: (chatJid: string, id: string) => Promise<void>;
  /** Exporta a conversa (.txt ou .zip com mídia) pelo diálogo "Salvar como"; devolve o caminho ou null se cancelou. */
  saveExport: (chatJid: string, withMedia: boolean, defaultName: string) => Promise<string | null>;
  onOpenChat: (cb: (jid: string) => void) => () => void;
  onOpenSettings: (cb: (tab?: string) => void) => () => void;
  /** Link "abrir conversa" (whatsapp://send) esperando esta conta; null se não há. */
  takeLink: () => Promise<{ phone: string; text: string } | null>;
  /** Avisa que chegou um link: a página busca com takeLink. */
  onLink: (cb: () => void) => () => void;
  accountInfo: () => Promise<AccountInfo | null>;
  renameAccount: (name: string) => Promise<AccountInfo | null>;
  addAccount: () => Promise<void>;
  onAccount: (cb: (info: AccountInfo) => void) => () => void;
  /** Traz a janela para a frente (ex.: depois de soltar um arquivo vindo do Explorer). */
  focusWindow?: () => void;
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
