import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultMcpFile, readMcpFile, removeMcpFile, writeMcpFile } from "../server/mcp-file.ts";

test("mcp.json: grava, lê, recusa inválido e remove", () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-mcp-"));
  const file = join(dir, "sub", "mcp.json");
  const info = { port: 38291, token: "a".repeat(64), account: "dev", pid: 123 };
  assert.equal(readMcpFile(file), null);
  writeMcpFile(file, info);
  assert.deepEqual(readMcpFile(file), info);
  writeFileSync(file, JSON.stringify({ port: 1, token: "curto" }));
  assert.equal(readMcpFile(file), null);
  writeFileSync(file, "nem json");
  assert.equal(readMcpFile(file), null);
  removeMcpFile(file);
  assert.equal(existsSync(file), false);
  removeMcpFile(file);
});

test("caminho padrão respeita INBOX_MCP_FILE e cai na pasta do app", () => {
  const custom = join("C:", "x", "mcp.json");
  const roaming = join("C:", "Users", "r", "AppData", "Roaming");
  assert.equal(defaultMcpFile({ INBOX_MCP_FILE: custom }), custom);
  assert.equal(defaultMcpFile({ APPDATA: roaming }), join(roaming, "WhatsApp Inbox", "mcp.json"));
});
