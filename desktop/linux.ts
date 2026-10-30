// Linux (AppImage): o que o Windows resolve sozinho e aqui precisa de arquivo próprio.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Argumento com que o AppImage roda o servidor MCP do Claude Code dentro do próprio app. */
export const MCP_SERVER_ARG = "--mcp-server";

/** Entrada de ~/.config/autostart: abre o app ao entrar na sessão (GNOME, KDE, XFCE...). */
export function autostartEntry(exe: string, hidden: boolean): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=WhatsApp Inbox",
    // Especificação do .desktop: entre aspas, " ` $ \ levam barra; depois o valor (string) dobra
    // cada barra; % vira %% para não ser lido como código de campo.
    `Exec="${exe.replace(/["`$\\]/g, (c) => `\\${c}`).replace(/\\/g, "\\\\").replace(/%/g, "%%")}"${hidden ? " --hidden" : ""}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** Liga ou desliga o início junto com o sistema. `configDir` é o XDG_CONFIG_HOME (~/.config). */
export function setAutostart(configDir: string, exe: string, on: boolean, hidden: boolean): void {
  const file = join(configDir, "autostart", "whatsapp-inbox.desktop");
  if (!on) return rmSync(file, { force: true });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, autostartEntry(exe, hidden));
}
