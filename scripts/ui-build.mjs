// Compila a interface (ui/) para dist/ com esbuild e grava a versão do build no bundle.
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    metafile: true,
  };
}

/**
 * Copia o index.html. Com o metafile do build, avisa o navegador logo no HTML quais arquivos
 * o app.js vai pedir (pedaço compartilhado e fonte principal), em vez de descobri-los depois.
 */
export async function copyHtml(metafile) {
  await mkdir(dist, { recursive: true });
  let html = await readFile(resolve(root, "ui/index.html"), "utf8");
  if (metafile) {
    const outputs = Object.keys(metafile.outputs).map((f) => "/" + f.replace(/\\/g, "/").split("dist/").pop());
    const links = [
      ...outputs.filter((f) => /^\/chunks\/chunk-.*\.js$/.test(f)).map((f) => `<link rel="modulepreload" href="${f}" />`),
      ...outputs.filter((f) => /manrope-latin-wght.*\.woff2$/.test(f)).map((f) => `<link rel="preload" as="font" type="font/woff2" href="${f}" crossorigin />`),
    ];
    html = html.replace("  </head>", `    ${links.join("\n    ")}\n  </head>`);
  }
  await writeFile(resolve(dist, "index.html"), html);
}
