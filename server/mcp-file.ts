// Arquivo de descoberta do servidor MCP: o app grava porta e token desta execução; o processo
// MCP (outro processo, stdio) lê para saber onde a API está. Sem Electron: usado pelos dois lados.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const mcpInfoSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  account: z.string(),
  pid: z.number().int().positive(),
});
export type McpInfo = z.infer<typeof mcpInfoSchema>;

/** `INBOX_MCP_FILE` ou a pasta de dados do app desktop (`userData` do Electron para "WhatsApp Inbox"). */
export function defaultMcpFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.INBOX_MCP_FILE) return env.INBOX_MCP_FILE;
  return join(env.APPDATA || homedir(), "WhatsApp Inbox", "mcp.json");
}

export function writeMcpFile(file: string, info: McpInfo): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(info), "utf8");
}

export function removeMcpFile(file: string): void {
  rmSync(file, { force: true });
}

/** null quando o arquivo não existe ou está inválido (app fechado ou versão antiga). */
export function readMcpFile(file: string): McpInfo | null {
  try {
    const parsed = mcpInfoSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
