import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "../server/app.ts";

test("encerrar o servidor não trava com a janela conectada ao SSE (instalação de atualização)", async () => {
  const app = await startApp({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "wi-close-")), distDir: "dist", waDisabled: true });
  assert.match(app.token, /^[0-9a-f]{64}$/);
  await new Promise<void>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: app.port, path: "/api/events" }, (res) => {
      res.once("data", () => resolve());
      res.on("error", () => undefined);
    });
    req.on("error", reject);
    req.end();
  });
  const started = Date.now();
  await Promise.race([app.close(), new Promise((_, reject) => setTimeout(() => reject(new Error("close() travou")), 3000))]);
  assert.ok(Date.now() - started < 3000);
});

test("markRead avisa onRead e send sem WhatsApp falha com mensagem clara", async () => {
  const read: string[] = [];
  const app = await startApp({
    port: 0,
    dataDir: mkdtempSync(join(tmpdir(), "wi-read-")),
    distDir: "dist",
    waDisabled: true,
    onRead: (jid) => read.push(jid),
  });
  try {
    await app.markRead("5511999999999@s.whatsapp.net");
    assert.deepEqual(read, ["5511999999999@s.whatsapp.net"]);
    await assert.rejects(app.send("5511999999999@s.whatsapp.net", "oi"), /WhatsApp ainda está iniciando/);
  } finally {
    await app.close();
  }
});

test("avatar sem WhatsApp devolve null sem travar", async () => {
  const app = await startApp({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "wi-av-app-")), distDir: "dist", waDisabled: true });
  try {
    assert.equal(await app.avatar("5511999999999@s.whatsapp.net"), null);
  } finally {
    await app.close();
  }
});
