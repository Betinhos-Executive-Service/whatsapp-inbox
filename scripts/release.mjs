// Publicação pelo CI (.github/workflows/release.yml), em três etapas:
// prepare → incrementa a versão, faz o commit "release: vX" na main e cria a release vX em
//           rascunho nesse commit (Windows e Linux compilam dele em paralelo, com pnpm release)
// finish  → libera a release quando os instaladores chegaram; os apps instalados avisam.
// Rascunho até o fim: app instalado nunca enxerga uma versão incompleta.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { bumpVersion, root } from "./ui-build.mjs";

const repo = "Betinhos-Executive-Service/whatsapp-inbox";
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();
const git = (...args) => run("git", ...args);
const gh = (...args) => run("gh", ...args, "-R", repo);

const [step, version] = process.argv.slice(2);

if (step === "prepare") {
  if (git("status", "--porcelain")) throw new Error("Há alterações sem commit. Faça o commit antes de publicar.");
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("Publique a partir da branch main.");
  const build = await bumpVersion();
  const tag = `v${build.version}`;
  git("add", "package.json");
  git("commit", "-m", `release: ${tag}`);
  try {
    git("push", "origin", "main");
  } catch (error) {
    // Outro merge chegou à main: a execução seguinte do CI já inclui estas mudanças e publica.
    const base = git("rev-parse", "HEAD~1");
    git("fetch", "--quiet", "origin", "main");
    const advanced = git("rev-parse", "origin/main") !== base && git("merge-base", "HEAD~1", "origin/main") === base;
    if (!advanced) throw error;
    console.warn(`A main recebeu commits novos; ${tag} fica para a próxima execução.`);
    process.exit(0);
  }
  git("fetch", "--tags", "--quiet");
  const previous = git("tag", "--list", "v*", "--sort=-v:refname").split(/\r?\n/).find((t) => t && t !== tag);
  const changes = git("log", "--no-merges", "--pretty=- %s", previous ? `${previous}..HEAD` : "HEAD")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("- release:") && !l.startsWith("- chore:"))
    .join("\n");
  const sha = git("rev-parse", "HEAD");
  gh("release", "create", tag, "--draft", "--target", sha, "--title", tag, "--notes", changes || "Melhorias e correções.");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${build.version}\nsha=${sha}\n`);
  console.log(`${tag} em rascunho no commit ${sha.slice(0, 7)}.`);
} else if (step === "finish" && version) {
  const tag = `v${version}`;
  const names = JSON.parse(gh("release", "view", tag, "--json", "assets")).assets.map((a) => a.name);
  // Windows é obrigatório; sem o Linux a versão sai assim mesmo, para não segurar quem usa Windows.
  if (!names.includes("latest.yml")) throw new Error(`${tag} sem o instalador do Windows; a release ficou em rascunho.`);
  if (!names.includes("latest-linux.yml")) console.warn(`${tag} sai sem o AppImage: o job do Linux falhou.`);
  gh("release", "edit", tag, "--draft=false", "--latest");
  console.log(`Versão ${tag} publicada: os apps instalados vão avisar da atualização.`);
} else {
  throw new Error("Uso: node scripts/release.mjs prepare | finish <versão>");
}
