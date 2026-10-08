// Registro do servidor MCP no Claude Code deste PC (`claude mcp add/remove/get`), sem shell.
// Funções puras aqui; quem executa é o app, com o `claude` que findClaudeBin achou.

export const MCP_NAME = "whatsapp-inbox";

/** Como abrir o processo MCP: `node server/mcp-main.ts` em dev, o próprio exe (modo Node) no pacote. */
export type McpEntry = { command: string; args: string[]; env: Record<string, string> };

export function addArgs(entry: McpEntry): string[] {
  const env = Object.entries(entry.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return ["mcp", "add", "--scope", "user", ...env, MCP_NAME, "--", entry.command, ...entry.args];
}

export const removeArgs = (): string[] => ["mcp", "remove", "--scope", "user", MCP_NAME];
export const getArgs = (): string[] => ["mcp", "get", MCP_NAME];

/** `claude mcp get` sai com erro (ou diz que não achou) quando o servidor não está registrado. */
export function isRegistered(output: string, ok: boolean): boolean {
  return ok && !/not found|não encontrado|no mcp server/i.test(output);
}

const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

/** Comando copiável para registrar à mão (mesma coisa que o botão faz). */
export function displayCommand(entry: McpEntry, claude = "claude"): string {
  return [quote(claude), ...addArgs(entry).map(quote)].join(" ");
}
