// pnpm app      → compila e abre o app desktop sem instalar (teste local)
// pnpm exe      → gera o instalador em release/ (sem publicar)
// pnpm release  → nova versão no GitHub Releases; os apps instalados avisam e atualizam
import { execFileSync, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import * as esbuild from "esbuild";
import { writeIcon } from "./icon.mjs";
import { bumpVersion, copyHtml, root, uiOptions } from "./ui-build.mjs";

const runOnly = process.argv.includes("--run");
const release = process.argv.includes("--publish");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (release) {
  // A versão publicada tem de corresponder a um commit no GitHub.
  if (git("status", "--porcelain")) throw new Error("Há alterações sem commit. Faça o commit antes de publicar.");
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("Publique a partir da branch main.");
}

const started = performance.now();
const build = await bumpVersion();
if (release) {
  git("add", "package.json");
  git("commit", "-m", `release: v${build.version}`);
  git("push", "origin", "main");
}

await rm(resolve(root, "dist"), { recursive: true, force: true });
await rm(resolve(root, "dist-electron"), { recursive: true, force: true });
await esbuild.build(uiOptions(build));
await copyHtml();
writeIcon(resolve(root, "dist/icon.ico"));
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
await esbuild.build({
  ...nodeOptions,
  entryPoints: [resolve(root, "desktop/preload.ts")],
  outfile: resolve(root, "dist-electron/preload.cjs"),
  format: "cjs",
  external: ["electron"],
});
console.log(`Build v${build.version} compilado em ${Math.round(performance.now() - started)} ms`);

if (runOnly) {
  const electron = (await import("electron")).default;
  spawn(electron, ["."], { cwd: root, stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
} else {
  if (release) {
    // Token da sessão do gh, só para este processo; nunca é impresso nem gravado.
    process.env.GH_TOKEN = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  }
  const { build: pack } = await import("electron-builder");
  const options = { win: ["nsis"], x64: true, publish: release ? "always" : "never" };
  // Na primeira publicação de uma versão, o electron-builder às vezes tenta criar a mesma
  // release duas vezes e o GitHub recusa uma delas. A segunda rodada só completa os arquivos.
  const files = await pack(options).catch((error) => {
    if (!release) throw error;
    console.warn("Publicação incompleta; tentando de novo…");
    return pack(options);
  });
  const installer = files.find((f) => f.endsWith(".exe"));
  console.log(release ? `Versão v${build.version} publicada no GitHub Releases.` : `Instalador pronto: ${installer}`);
}
