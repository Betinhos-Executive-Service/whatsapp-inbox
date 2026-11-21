import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "../server/app.ts";
import { Store } from "../server/db.ts";
import { DEFAULT_PREFS } from "../server/prefs.ts";

test("funções de IA desligadas: servidor recusa classificar e gerar perfil", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "wi-toggles-"));
  const seed = new Store(join(dataDir, "inbox.db"));
  seed.ensureChat("5511999999999@s.whatsapp.net");
  seed.db.close();
  const app = await startApp({ port: 0, dataDir, distDir: "dist", waDisabled: true });
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${app.port}${path}`, {
      method,
      headers: { "x-inbox-token": app.token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal(DEFAULT_PREFS.useAiClassify && DEFAULT_PREFS.usePriority && DEFAULT_PREFS.usePersona && DEFAULT_PREFS.useClaudeAgent, true);
    const saved = await call("PUT", "/api/settings", { prefs: { useAiClassify: false, usePersona: false } });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal(app.prefs().useAiClassify, false);
    assert.equal(app.prefs().usePersona, false);
    assert.equal(app.prefs().usePriority, true);
    const jid = encodeURIComponent("5511999999999@s.whatsapp.net");
    const classify = await call("POST", `/api/chats/${jid}/classify`);
    assert.match(await classify.text(), /classificação por IA está desligada/);
    const persona = await call("POST", `/api/chats/${jid}/persona`, {});
    assert.match(await persona.text(), /perfil por IA está desligado/);
  } finally {
    await app.close();
  }
});
