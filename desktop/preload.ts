// Ponte mínima entre a página e o app desktop: só o aviso de versão nova.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  getUpdate: () => ipcRenderer.invoke("update:get"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
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
