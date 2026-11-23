// Arquivos na área de transferência do sistema (o Ctrl+C do Explorer), um ou vários de uma vez.
// O Electron só grava texto e imagem. No Windows quem grava é um PowerShell que fica aberto entre
// as cópias: abrir um a cada cópia custava perto de um segundo.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Lê um pedido por linha (JSON só com ASCII) e responde "ok" ou "err motivo". Sem aspas duplas: vai como argumento. */
const SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "[Console]::Out.WriteLine('ready')",
  "while($null -ne ($line=[Console]::In.ReadLine())){try{" +
    "$r=$line|ConvertFrom-Json;" +
    "$d=New-Object System.Windows.Forms.DataObject;" +
    "$l=New-Object System.Collections.Specialized.StringCollection;" +
    "foreach($p in $r.paths){[void]$l.Add([string]$p)};" +
    "$d.SetFileDropList($l);" +
    "if($r.text){$d.SetText([string]$r.text)};" +
    "[System.Windows.Forms.Clipboard]::SetDataObject($d,$true,10,100);" +
    "[Console]::Out.WriteLine('ok')" +
    "}catch{[Console]::Out.WriteLine('err '+($_.Exception.Message -replace '\\s+',' '))}}",
].join(";");

const IDLE_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;

/** Pedido em uma linha só com ASCII: a entrada do PowerShell não é UTF-8, então acento vai como \uXXXX. */
export function requestLine(paths: string[], text: string): string {
  return JSON.stringify({ paths, text }).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

type Helper = { child: ChildProcessWithoutNullStreams; ready: Promise<void>; next: () => Promise<string> };

let helper: Helper | null = null;
let queue: Promise<unknown> = Promise.resolve();
let idle: NodeJS.Timeout | undefined;

function startHelper(): Helper {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const waiting: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  const lines: string[] = [];
  let buffer = "";
  let dead: Error | null = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      const w = waiting.shift();
      if (w) w.resolve(line);
      else lines.push(line);
    }
  });
  child.stderr.resume();
  child.stdin.on("error", () => undefined);
  const fail = (error: Error) => {
    dead ??= error;
    if (helper?.child === child) helper = null;
    for (const w of waiting.splice(0)) w.reject(dead);
  };
  child.on("error", fail);
  child.on("exit", () => fail(new Error("Não foi possível copiar o arquivo. Tente de novo.")));
  const next = () => (lines.length ? Promise.resolve(lines.shift()!) : dead ? Promise.reject(dead) : new Promise<string>((resolve, reject) => waiting.push({ resolve, reject })));
  const ready = next().then((line) => {
    if (line !== "ready") throw new Error(`Não foi possível copiar o arquivo. ${line}`.trim());
  });
  ready.catch(() => child.kill());
  return { child, ready, next };
}

async function copyWindows(paths: string[], text: string): Promise<void> {
  clearTimeout(idle);
  const h = (helper ??= startHelper());
  const timeout = setTimeout(() => h.child.kill(), TIMEOUT_MS);
  try {
    await h.ready;
    h.child.stdin.write(`${requestLine(paths, text)}\n`);
    const answer = await h.next();
    if (answer !== "ok") throw new Error(`Não foi possível copiar o arquivo. ${answer.replace(/^err ?/, "")}`.trim());
  } finally {
    clearTimeout(timeout);
    idle = setTimeout(() => helper?.child.stdin.end(), IDLE_MS);
    idle.unref();
  }
}

/** Linux: text/uri-list (o que o gerenciador de arquivos cola) pelo wl-copy no Wayland ou xclip no X11. */
function copyLinux(paths: string[]): Promise<void> {
  const [cmd, ...args] = process.env.WAYLAND_DISPLAY ? ["wl-copy", "--type", "text/uri-list"] : ["xclip", "-selection", "clipboard", "-t", "text/uri-list"];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd!, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end(paths.map((p) => `${pathToFileURL(p).href}\r\n`).join(""));
    child.on("error", (error: NodeJS.ErrnoException) => reject(error.code === "ENOENT" ? new Error(`Para copiar arquivo no Linux, instale o ${cmd}.`) : error));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Não foi possível copiar o arquivo. ${stderr.trim()}`.trim()))));
  });
}

/**
 * Põe os arquivos na área de transferência. No Windows o texto vai junto, em outro formato:
 * colar no Explorer traz os arquivos, colar num editor de texto traz o texto.
 */
export function copyFilesToClipboard(paths: string[], text = ""): Promise<void> {
  if (process.platform !== "win32") return copyLinux(paths);
  const run = () => copyWindows(paths, text);
  const done = queue.then(run, run);
  queue = done.catch(() => undefined);
  return done;
}

/** Deixa o ajudante do Windows aberto antes do clique em Copiar (abrir leva perto de um segundo). */
export function warmFileClipboard(): void {
  if (process.platform !== "win32" || helper) return;
  helper = startHelper();
  clearTimeout(idle);
  idle = setTimeout(() => helper?.child.stdin.end(), IDLE_MS);
  idle.unref();
}
