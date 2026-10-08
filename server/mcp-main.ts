// Entrada do servidor MCP (stdio) do WhatsApp Inbox, registrado no Claude Code com
// `claude mcp add`. Fala com o app pela API HTTP local; sem o app aberto, cada ferramenta avisa.
// stdout é o protocolo: nada de console.log aqui nem nos módulos importados.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createInboxClient } from "./inbox-client.ts";
import { defaultMcpFile } from "./mcp-file.ts";
import { createMcpServer } from "./mcp.ts";

const client = createInboxClient({ fetch: globalThis.fetch, file: defaultMcpFile() });
const server = createMcpServer(client);
await server.connect(new StdioServerTransport());
