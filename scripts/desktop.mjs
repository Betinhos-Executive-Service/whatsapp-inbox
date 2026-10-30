// pnpm app      → compila e abre o app desktop sem instalar (teste local)
// pnpm exe      → gera o instalador em release/ (sem publicar)
// pnpm release  → nova versão no GitHub Releases; os apps instalados avisam e atualizam
// No Linux, o mesmo comando gera AppImage; o release anexa à versão já publicada pelo Windows
// (job "linux" do CI, no commit da tag), sem incrementar a versão.
import { appendFileSync, statSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import * as esbuild from "esbuild";
import { writeIcon, writePng } from "./icon.mjs";
import { bumpVersion, copyHtml, root, uiOptions } from "./ui-build.mjs";

const runOnly = process.argv.includes("--run");
const release = process.argv.includes("--publish");
const linux = process.platform === "linux";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (release) {
  // A versão publicada tem de corresponder a um commit no GitHub.
  if (git("status", "--porcelain")) throw new Error("Há alterações sem commit. Faça o commit antes de publicar.");
  if (!linux && git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("Publique a partir da branch main.");
}

const started = performance.now();
const build = await bumpVersion({ bump: !(release && linux) });
if (release && linux && git("rev-parse", "HEAD") !== git("rev-parse", `v${build.version}^{commit}`)) {
  throw new Error(`Publique o Linux a partir da tag v${build.version}.`);
}
let pushed = Promise.resolve();
if (release && !linux) {
  git("add", "package.json");
  git("commit", "-m", `release: v${build.version}`);
  // O envio corre junto com a compilação; a release só é criada depois que ele termina.
  pushed = new Promise((ok, fail) =>
    spawn("git", ["push", "origin", "main"], { cwd: root, stdio: "inherit" }).on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`git push falhou (código ${code}).`)),
    ),
  );
  pushed.catch(() => {}); // a falha é tratada em confirmPush(), antes de gerar o instalador
}

/**
 * Se a main andou durante o build (outro merge chegou), a execução seguinte do CI já
 * inclui estas mudanças e publica a versão; esta encerra sem erro e sem instalador.
 */
async function confirmPush() {
  try {
    await pushed;
  } catch (error) {
    const base = git("rev-parse", "HEAD~1");
    git("fetch", "--quiet", "origin", "main");
    const remote = git("rev-parse", "origin/main");
    const advanced = remote !== base && git("merge-base", "HEAD~1", "origin/main") === base;
    if (!advanced) throw error;
    console.warn(`A main recebeu commits novos durante o build; v${build.version} fica para a próxima execução.`);
    process.exit(0);
  }
}

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
  if (release) await confirmPush();
  const { build: pack } = await import("electron-builder");
  // O instalador e o latest.yml são gerados aqui; o envio ao GitHub é feito pelo gh (abaixo),
  // porque o envio do electron-builder não retoma quando a conexão cai no meio.
  const files = await pack({ ...(linux ? { linux: ["AppImage"] } : { win: ["nsis"] }), x64: true, publish: "never" });
  const installer = files.find((f) => /\.(exe|AppImage)$/.test(f));
  if (!release) {
    console.log(`Instalador pronto: ${installer}`);
  } else {
    await publishRelease(build.version, files);
  }
}

/**
 * Publica como rascunho, envia cada arquivo com novas tentativas, confere os tamanhos no
 * GitHub e só então libera a release. App instalado nunca enxerga uma versão incompleta.
 * No Linux só anexa o AppImage e o latest-linux.yml à release que o Windows já liberou.
 */
async function publishRelease(version, files) {
  const tag = `v${version}`;
  const repo = "Betinhos-Executive-Service/whatsapp-inbox";
  const gh = (...args) => execFileSync("gh", [...args, "-R", repo], { cwd: root, encoding: "utf8" }).trim();
  const assets = [...files.filter((f) => /\.(exe|AppImage|blockmap)$/.test(f)), resolve(root, "release", linux ? "latest-linux.yml" : "latest.yml")];
  // Linux: a release já está no ar (Windows); o AppImage entra nela e os apps Linux passam a ver a versão.
  if (!linux) {
    git("fetch", "--tags", "--quiet");
    const previous = git("tag", "--list", "v*", "--sort=-v:refname").split(/\r?\n/).find((t) => t && t !== tag);
    const changes = git("log", "--no-merges", "--pretty=- %s", previous ? `${previous}..HEAD` : "HEAD")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("- release:") && !l.startsWith("- chore:"))
      .join("\n");
    gh("release", "create", tag, "--draft", "--target", git("rev-parse", "HEAD"), "--title", tag, "--notes", changes || "Melhorias e correções.");
  }
  for (const file of assets) {
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
  for (const file of assets) {
    const name = basename(file);
    const found = remote.find((a) => a.name === name);
    if (!found || found.size !== statSync(file).size) throw new Error(`Arquivo ${name} não confere no GitHub${linux ? "" : "; a release ficou em rascunho"}.`);
  }
  if (linux) return console.log(`AppImage anexado à versão ${tag}.`);
  gh("release", "edit", tag, "--draft=false", "--latest");
  // No CI, o job do Linux usa esta versão para anexar o AppImage à mesma release.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Versão ${tag} publicada: os apps instalados vão avisar da atualização.`);
}
