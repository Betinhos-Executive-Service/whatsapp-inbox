import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "../server/app.ts";

test("encerrar o servidor não trava com a janela conectada ao SSE (instalação de atualização)", async () => {
  const app = await startApp({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "wi-close-")), distDir: "dist", waDisabled: true });
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
