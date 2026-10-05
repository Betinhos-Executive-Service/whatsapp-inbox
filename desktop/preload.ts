// Ponte mínima entre a página e o app desktop: atualização, versão e atalhos da bandeja/notificação.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  getUpdate: () => ipcRenderer.invoke("update:get"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  appInfo: () => ipcRenderer.invoke("app:info"),
  onOpenChat: (callback: (jid: string) => void) => {
    const listener = (_event: unknown, jid: string) => callback(jid);
    ipcRenderer.on("app:open-chat", listener);
    return () => ipcRenderer.removeListener("app:open-chat", listener);
  },
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:open-settings", listener);
    return () => ipcRenderer.removeListener("app:open-settings", listener);
  },
  onUpdate: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  onRemind: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("update:remind", listener);
    return () => ipcRenderer.removeListener("update:remind", listener);
  },
});
