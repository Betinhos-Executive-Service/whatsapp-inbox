// Compila a interface (ui/) para dist/ com esbuild e grava a versão do build no bundle.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

/** Incrementa o PATCH da versão de build (não é versão Git) e devolve versão + data ISO. */
export async function bumpVersion() {
  const path = resolve(root, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8"));
  const m = String(pkg.version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Versão inválida em package.json: ${pkg.version}`);
  pkg.version = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  return { version: pkg.version, date: new Date().toISOString(), port: pkg.config.port };
}

export function uiOptions({ version, date }, { dev = false } = {}) {
  return {
    entryPoints: { app: resolve(root, "ui/main.tsx") },
    outdir: dist,
    bundle: true,
    format: "esm",
    // Configurações viram um pedaço à parte, carregado só quando abertas.
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    target: "es2022",
    jsx: "automatic",
    minify: !dev,
    sourcemap: dev ? "linked" : false,
    legalComments: "none",
    loader: { ".woff2": "file", ".ttf": "file" },
    assetNames: "assets/[name]-[hash]",
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_DATE__: JSON.stringify(date),
      "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
    },
    logLevel: "warning",
  };
}

export async function copyHtml() {
  await mkdir(dist, { recursive: true });
  await copyFile(resolve(root, "ui/index.html"), resolve(dist, "index.html"));
}
