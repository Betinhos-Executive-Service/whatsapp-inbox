// Ponte do trilho de contas: só listar, escolher, abrir o menu da conta e adicionar.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rail", {
  onState: (callback: (accounts: unknown) => void) => {
    ipcRenderer.on("rail:state", (_event, accounts: unknown) => callback(accounts));
    ipcRenderer.send("rail:ready");
  },
  select: (id: string) => ipcRenderer.send("rail:select", id),
  menu: (id: string) => ipcRenderer.send("rail:menu", id),
  add: () => ipcRenderer.send("rail:add"),
});
