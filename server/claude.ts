// IA pelo plano do Claude (sem API): chama o Claude Code instalado neste PC (`claude -p`),
// logado na conta da pessoa. Herda o CLAUDE.md global, os hooks e os MCPs/conectores do
// claude.ai já autorizados. Só funciona neste computador e consome o limite do plano.
// Ferramentas ficam bloqueadas, exceto a leitura do Dataverse (lista abaixo).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Message } from "./db.ts";
import type { TokenUsage } from "./pricing.ts";
import { draftPrompt, guardDraft, parseSummary, plainTranscript, summaryPrompt, unquote, type Prompt, type Summary } from "./ai.ts";
import { DEEPSEEK_CONTEXT_MESSAGES, DEEPSEEK_MESSAGE_CHARS } from "./deepseek.ts";

/** Modelos do plano oferecidos no app (alias do Claude Code). */
export const CLAUDE_MODELS = {
  sonnet: { name: "Sonnet", hint: "Equilíbrio entre qualidade e limite do plano." },
  opus: { name: "Opus", hint: "Mais forte e mais lento. Gasta mais do limite do plano." },
  haiku: { name: "Haiku", hint: "Mais rápido. Gasta menos do limite do plano." },
} as const;
export type ClaudeModel = keyof typeof CLAUDE_MODELS;
export const isClaudeModel = (v: unknown): v is ClaudeModel => typeof v === "string" && v in CLAUDE_MODELS;
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = "sonnet";

/** Só leitura no Dataverse de PROD; qualquer outra ferramenta é negada no modo não interativo. */
export const CLAUDE_ALLOWED_TOOLS = ["mcp__Dataverse_PROD__read_query", "mcp__Dataverse_PROD__search", "mcp__Dataverse_PROD__describe"];
/** O Claude Code sobe todos os MCPs antes de responder: a primeira chamada passa de 1 minuto. */
const TIMEOUT_MS = 180_000;
const WINDOW = { messages: DEEPSEEK_CONTEXT_MESSAGES, chars: DEEPSEEK_MESSAGE_CHARS } as const;
const DATAVERSE_HINT =
  "\n\nSe precisar confirmar dados de reservas, motoristas ou passageiros, consulte o Dataverse só para leitura. Responda apenas com o texto pedido, sem comentar as consultas.";

/** Caminho do executável: CLAUDE_BIN, a instalação nativa (~/.local/bin) ou o PATH. */
export function findClaudeBin(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CLAUDE_BIN) return existsSync(env.CLAUDE_BIN) ? env.CLAUDE_BIN : null;
  const names = process.platform === "win32" ? ["claude.exe"] : ["claude"];
  const dirs = [join(homedir(), ".local", "bin"), ...(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)];
  for (const dir of dirs) for (const name of names) if (existsSync(join(dir, name))) return join(dir, name);
  return null;
}

export type ClaudeRun = (bin: string, args: string[], input: string, cwd: string) => Promise<string>;

/** Executa o CLI sem shell; o texto da conversa vai pela entrada padrão, nunca pela linha de comando. */
export const runClaude: ClaudeRun = (bin, args, input, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("O Claude demorou demais para responder. Tente de novo."));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível abrir o Claude Code (${e.message}).`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new Error(`O Claude Code saiu sem resposta (código ${code}). ${err.trim().slice(0, 200)}`.trim()));
    });
    child.stdin.end(input);
  });

type ResultJson = {
  is_error?: boolean;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};

export class ClaudePlanAI {
  private readonly cwd: string;
  private readonly model: () => ClaudeModel;
  private readonly bin: () => string | null;
  private readonly run: ClaudeRun;

  constructor(cwd: string, model: () => ClaudeModel = () => DEFAULT_CLAUDE_MODEL, bin: () => string | null = findClaudeBin, run: ClaudeRun = runClaude) {
    this.cwd = cwd;
    this.model = model;
    this.bin = bin;
    this.run = run;
  }

  private async complete({ system, user }: Prompt): Promise<{ text: string; usage: TokenUsage }> {
    const bin = this.bin();
    if (!bin) throw new Error("Claude Code não encontrado neste PC. Instale e faça login com `claude` no terminal.");
    mkdirSync(this.cwd, { recursive: true });
    const args = [
      "-p",
      "--output-format", "json",
      "--model", this.model(),
      "--append-system-prompt", system + DATAVERSE_HINT,
      "--allowedTools", CLAUDE_ALLOWED_TOOLS.join(","),
    ];
    const raw = await this.run(bin, args, user, this.cwd);
    let data: ResultJson;
    try {
      data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as ResultJson;
    } catch {
      throw new Error("O Claude Code devolveu uma resposta ilegível. Confira se o login está ativo (`claude` no terminal).");
    }
    const text = data.result?.trim();
    if (data.is_error || !text) throw new Error(`O Claude não respondeu${text ? `: ${text.slice(0, 200)}` : "."}`);
    const u = data.usage ?? {};
    const cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    return { text, usage: { inputTokens: (u.input_tokens ?? 0) + cached, outputTokens: u.output_tokens ?? 0, cachedTokens: cached } };
  }

  async draft(contactName: string, messages: Message[], instructions: string): Promise<{ text: string; usage: TokenUsage }> {
    const { text, usage } = await this.complete(draftPrompt(contactName, messages, instructions, true, WINDOW));
    return { text: guardDraft(unquote(text), plainTranscript(contactName, messages, WINDOW)), usage };
  }

  async summarize(contactName: string, messages: Message[]): Promise<{ summary: Summary; usage: TokenUsage }> {
    const { text, usage } = await this.complete(summaryPrompt(contactName, messages, true, WINDOW));
    return { summary: parseSummary(text), usage };
  }
}
