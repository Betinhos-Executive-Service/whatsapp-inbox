// pnpm dev: incrementa a versão, recompila a interface a cada mudança e reinicia o servidor
// quando o código do servidor muda. A porta é fixa (package.json → config.port).
// Se a porta estiver ocupada por este projeto, encerra o processo antigo; se for outro serviço, falha.
import { execSync, spawn } from "node:child_process";
import * as esbuild from "esbuild";
import { bumpVersion, copyHtml, root, uiOptions } from "./ui-build.mjs";

function pidsOnPort(port) {
  let out = "";
  try {
    out = execSync("netstat -ano", { encoding: "utf8" });
  } catch {
    return [];
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] === "TCP" && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
  }
  return [...pids].filter((pid) => pid > 0);
}

function commandLine(pid) {
  try {
    return execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

async function freePort(port) {
  for (const pid of pidsOnPort(port)) {
    const cmd = commandLine(pid);
    const ours = cmd.toLowerCase().includes(root.toLowerCase()) || /server[\\/]main\.ts/i.test(cmd);
    if (!ours) {
      console.error(`Porta ${port} ocupada por outro serviço (PID ${pid}): ${cmd || "comando desconhecido"}`);
      process.exit(1);
    }
    console.log(`Porta ${port} em uso por uma instância anterior (PID ${pid}). Encerrando...`);
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  }
  for (let i = 0; i < 20 && pidsOnPort(port).length; i++) await new Promise((r) => setTimeout(r, 250));
  if (pidsOnPort(port).length) {
    console.error(`Porta ${port} não liberou a tempo.`);
    process.exit(1);
  }
}

const build = await bumpVersion();
await freePort(build.port);
await copyHtml();
const ctx = await esbuild.context(uiOptions(build, { dev: true }));
await ctx.rebuild();
await ctx.watch();

const server = spawn(process.execPath, ["--watch-path=server", "server/main.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: String(build.port) },
});
console.log(`Dev v${build.version} · interface recompila sozinha; recarregue a página após editar.`);

const stop = async () => {
  server.kill();
  await ctx.dispose();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
