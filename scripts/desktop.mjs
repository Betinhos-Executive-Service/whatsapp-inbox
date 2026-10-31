// pnpm app      → compila e abre o app desktop sem instalar (teste local)
// pnpm exe      → gera o instalador deste sistema em release/ (sem publicar)
// pnpm release  → (CI) gera o instalador deste sistema (Windows ou Linux) na versão já gravada e
//                 o envia à release em rascunho criada por scripts/release.mjs prepare
import { statSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import * as esbuild from "esbuild";
import { writeIcon, writePng } from "./icon.mjs";
import { bumpVersion, copyHtml, root, uiOptions } from "./ui-build.mjs";

const runOnly = process.argv.includes("--run");
const release = process.argv.includes("--publish");
const linux = process.platform === "linux";

// Só o CI publica: à mão, o --clobber sobrescreveria os arquivos da versão já liberada.
if (release && !process.env.GITHUB_ACTIONS) throw new Error("pnpm release só roda no workflow da main.");
// A versão publicada tem de corresponder ao commit "release: vX" que o prepare enviou.
if (release && execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) {
  throw new Error("Há alterações sem commit. Faça o commit antes de publicar.");
}

const started = performance.now();
const build = await bumpVersion({ bump: !release });

await rm(resolve(root, "dist"), { recursive: true, force: true });
await rm(resolve(root, "dist-electron"), { recursive: true, force: true });
const ui = await esbuild.build(uiOptions(build));
await copyHtml(ui.metafile);
if (linux) writePng(resolve(root, "dist/icon.png"));
else writeIcon(resolve(root, "dist/icon.ico"));
const nodeOptions = { bundle: true, platform: "node", target: "node24", logLevel: "warning" };
await esbuild.build({
  ...nodeOptions,
  entryPoints: { main: resolve(root, "desktop/main.ts") },
  outdir: resolve(root, "dist-electron"),
  outExtension: { ".js": ".mjs" },
  splitting: true, // Baileys e Jev continuam carregando depois da janela
  format: "esm",
  packages: "external",
});
// Servidor MCP para o Claude Code: o exe roda este arquivo em modo Node (ELECTRON_RUN_AS_NODE=1).
// Tudo empacotado (SDK e zod ficam dentro), porque o instalador não leva node_modules.
await esbuild.build({
  ...nodeOptions,
  entryPoints: [resolve(root, "server/mcp-main.ts")],
  outfile: resolve(root, "dist-electron/mcp.mjs"),
  format: "esm",
  // Dependências CommonJS do SDK usam require(); em ESM ele precisa ser recriado.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await esbuild.build({
  ...nodeOptions,
  entryPoints: [resolve(root, "desktop/preload.ts")],
  outfile: resolve(root, "dist-electron/preload.cjs"),
  format: "cjs",
  external: ["electron"],
});
await esbuild.build({
  ...nodeOptions,
  entryPoints: [resolve(root, "desktop/rail-preload.ts")],
  outfile: resolve(root, "dist-electron/rail-preload.cjs"),
  format: "cjs",
  external: ["electron"],
});
// Trilho de contas: página própria da janela, com as várias contas ao lado.
await esbuild.build({
  entryPoints: { rail: resolve(root, "desktop/rail/rail.ts"), "rail-style": resolve(root, "desktop/rail/rail.css") },
  outdir: resolve(root, "dist/rail"),
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "none",
  loader: { ".woff2": "file" },
  assetNames: "assets/[name]-[hash]",
  logLevel: "warning",
});
await copyFile(resolve(root, "desktop/rail/index.html"), resolve(root, "dist/rail/index.html"));
console.log(`Build v${build.version} compilado em ${Math.round(performance.now() - started)} ms`);

if (runOnly) {
  const electron = (await import("electron")).default;
  spawn(electron, ["."], { cwd: root, stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
} else {
  const { build: pack } = await import("electron-builder");
  // O instalador e o latest.yml são gerados aqui; o envio ao GitHub é feito pelo gh (abaixo),
  // porque o envio do electron-builder não retoma quando a conexão cai no meio.
  const files = await pack({ ...(linux ? { linux: ["AppImage"] } : { win: ["nsis"] }), x64: true, publish: "never" });
  const installer = files.find((f) => /\.(exe|AppImage)$/.test(f));
  if (!release) {
    console.log(`Instalador pronto: ${installer}`);
  } else {
    await uploadAssets(build.version, files);
  }
}

/**
 * Envia cada arquivo com novas tentativas e confere os tamanhos no GitHub. A release ainda é
 * rascunho; o scripts/release.mjs finish a libera quando Windows e Linux terminaram.
 */
async function uploadAssets(version, files) {
  const tag = `v${version}`;
  const repo = "Betinhos-Executive-Service/whatsapp-inbox";
  const gh = (...args) => execFileSync("gh", [...args, "-R", repo], { cwd: root, encoding: "utf8" }).trim();
  const send = async (list) => {
    for (const file of list) {
      for (let attempt = 1; ; attempt++) {
        try {
          gh("release", "upload", tag, file, "--clobber");
          break;
        } catch (error) {
          if (attempt >= 5) throw new Error(`Falha ao enviar ${basename(file)} depois de 5 tentativas: ${error.message}`);
          console.warn(`Envio de ${basename(file)} falhou (tentativa ${attempt}); tentando de novo…`);
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }
    }
    const remote = JSON.parse(gh("release", "view", tag, "--json", "assets")).assets;
    for (const file of list) {
      const name = basename(file);
      const found = remote.find((a) => a.name === name);
      if (!found || found.size !== statSync(file).size) throw new Error(`Arquivo ${name} não confere no GitHub; a release ficou em rascunho.`);
    }
  };
  // O latest*.yml vai só depois dos instaladores conferidos: o finish libera a versão ao vê-lo.
  await send(files.filter((f) => /\.(exe|AppImage|blockmap)$/.test(f)));
  await send([resolve(root, "release", linux ? "latest-linux.yml" : "latest.yml")]);
  console.log(`Instalador ${linux ? "Linux" : "Windows"} enviado à versão ${tag} (rascunho).`);
}
