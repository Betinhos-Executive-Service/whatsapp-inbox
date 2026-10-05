// Entrada pelo terminal (pnpm dev / pnpm serve). O app desktop usa startApp() direto.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startApp } from "./app.ts";

const root = resolve(import.meta.dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { config: { port: number } };
const port = Number(process.env.PORT) || pkg.config.port;

try {
  const app = await startApp({
    port,
    dataDir: resolve(root, process.env.DATA_DIR ?? "data"),
    distDir: join(root, "dist"),
    waDisabled: process.env.WA_DISABLED === "1",
  });
  process.stdout.write(`WhatsApp Inbox em http://127.0.0.1:${app.port}\n`);
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    process.stderr.write(`A porta ${port} já está em uso. O app já está aberto? Acesse http://127.0.0.1:${port}\n`);
    process.exit(1);
  }
  throw error;
}
