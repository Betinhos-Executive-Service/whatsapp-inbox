// Copia os componentes do Design System Betinhos (@betinhos/ui, repo Sistema Betinhos) para ui/ds/.
// A cópia fica versionada aqui porque o CI do release não tem o repo vizinho.
// Uso: node scripts/sync-ds.mjs [caminho de packages/ui/src]
import { cp, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = resolve(process.argv[2] ?? process.env.BETINHOS_DS ?? "C:/Users/mendo/Desktop/vscode/Sistema Betinhos/packages/ui/src");
const out = join(root, "ui", "ds");

await stat(join(src, "index.ts")).catch(() => {
  throw new Error(`Design System não encontrado em ${src}`);
});
await rm(out, { recursive: true, force: true });
await cp(src, out, { recursive: true, filter: (p) => !/\.test\.tsx?$/.test(p) });

// O app usa moduleResolution nodenext: import relativo precisa da extensão.
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.tsx?$/.test(entry.name)) await fixImports(path);
  }
}
async function fixImports(path) {
  const dir = path.slice(0, path.lastIndexOf("\\") + 1 || path.lastIndexOf("/") + 1);
  let text = await readFile(path, "utf8");
  const matches = [...text.matchAll(/from '(\.{1,2}\/[^']+)'/g)];
  for (const [whole, spec] of matches) {
    if (/\.(tsx?|css)$/.test(spec)) continue;
    let ext = null;
    for (const e of [".tsx", ".ts"]) {
      if (await stat(join(dir, spec + e)).then(() => true, () => false)) { ext = e; break; }
    }
    if (!ext) throw new Error(`Import sem arquivo: ${spec} em ${path}`);
    text = text.replace(whole, `from '${spec}${ext}'`);
  }
  await writeFile(path, text);
}
await walk(out);
console.log(`Design System copiado de ${src} para ui/ds/`);
