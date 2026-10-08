import assert from "node:assert/strict";
import { test } from "node:test";
import { addArgs, displayCommand, getArgs, isRegistered, removeArgs } from "../server/mcp-register.ts";

const entry = { command: "C:\\Program Files\\WhatsApp Inbox\\WhatsApp Inbox.exe", args: ["C:\\app\\dist-electron\\mcp.mjs"], env: { ELECTRON_RUN_AS_NODE: "1", INBOX_MCP_FILE: "C:\\dados\\mcp.json" } };

test("claude mcp add: variáveis antes do nome, `--` antes do comando, sem shell", () => {
  assert.deepEqual(addArgs(entry), [
    "mcp", "add", "--scope", "user",
    "-e", "ELECTRON_RUN_AS_NODE=1",
    "-e", "INBOX_MCP_FILE=C:\\dados\\mcp.json",
    "whatsapp-inbox", "--",
    "C:\\Program Files\\WhatsApp Inbox\\WhatsApp Inbox.exe", "C:\\app\\dist-electron\\mcp.mjs",
  ]);
  assert.deepEqual(removeArgs(), ["mcp", "remove", "--scope", "user", "whatsapp-inbox"]);
  assert.deepEqual(getArgs(), ["mcp", "get", "whatsapp-inbox"]);
});

test("comando copiável coloca aspas só em caminhos com espaço", () => {
  const cmd = displayCommand(entry);
  assert.ok(cmd.startsWith("claude mcp add --scope user -e ELECTRON_RUN_AS_NODE=1 "));
  assert.ok(cmd.includes('"C:\\Program Files\\WhatsApp Inbox\\WhatsApp Inbox.exe" C:\\app\\dist-electron\\mcp.mjs'));
  assert.ok(cmd.includes(" whatsapp-inbox -- "));
});

test("isRegistered: só quando o comando deu certo e não disse que não achou", () => {
  assert.equal(isRegistered("whatsapp-inbox:\n  Scope: User\n  Status: ✓ Connected", true), true);
  assert.equal(isRegistered("No MCP server found with name: whatsapp-inbox", true), false);
  assert.equal(isRegistered("", false), false);
});
