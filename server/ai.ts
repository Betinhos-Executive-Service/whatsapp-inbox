// IA local: modelo pequeno rodando no próprio PC (node-llama-cpp), sem enviar a conversa
// para fora. Baixado uma vez sob pedido; carrega na primeira geração e descarrega parado.
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "./db.ts";

export const MODEL = {
  name: "Qwen2.5 1.5B Instruct (Q4_K_M)",
  file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  size: 1_117_320_736,
};

export const DEFAULT_INSTRUCTIONS =
  "Você responde pela Betinhos Executive Service, transporte executivo terrestre. Tom humano, preciso e seguro: cordial, direto, sem gírias e sem exagero. Frases curtas. Nunca invente preço, horário, placa ou nome de motorista: se faltar a informação, diga que vai confirmar.";

export type AiStatus =
  | { state: "ausente" }
  | { state: "baixando"; percent: number }
  | { state: "pronto"; loaded: boolean }
  | { state: "erro"; message: string };

export type Summary = { resumo: string; pedido: string; proximoPasso: string };

const IDLE_UNLOAD_MS = 5 * 60 * 1000;

function transcript(contactName: string, messages: Message[]): string {
  return messages
    .filter((m) => m.text.trim())
    .slice(-25)
    .map((m) => `${m.fromMe ? "Eu" : contactName}: ${m.text.slice(0, 600)}`)
    .join("\n");
}

export class LocalAI {
  private readonly dir: string;
  private readonly onStatus: (s: AiStatus) => void;
  private downloading: { percent: number } | null = null;
  private lastError: string | null = null;
  // Objetos do node-llama-cpp (tipados como unknown para não carregar o módulo no início).
  private model: { dispose: () => Promise<void> } | null = null;
  private loading: Promise<unknown> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string, onStatus: (s: AiStatus) => void) {
    this.dir = dir;
    this.onStatus = onStatus;
  }

  private get path() {
    return join(this.dir, MODEL.file);
  }

  status(): AiStatus {
    if (this.downloading) return { state: "baixando", percent: this.downloading.percent };
    if (this.lastError) return { state: "erro", message: this.lastError };
    return existsSync(this.path) ? { state: "pronto", loaded: !!this.model } : { state: "ausente" };
  }

  private emit() {
    this.onStatus(this.status());
  }

  /** Baixa o modelo em segundo plano; o progresso sai por onStatus. */
  async download(): Promise<void> {
    if (this.downloading || existsSync(this.path)) return;
    this.lastError = null;
    this.downloading = { percent: 0 };
    this.emit();
    try {
      await mkdir(this.dir, { recursive: true });
      const { createModelDownloader } = await import("node-llama-cpp");
      const downloader = await createModelDownloader({
        modelUri: MODEL.url,
        dirPath: this.dir,
        fileName: MODEL.file,
        showCliProgress: false,
        onProgress: ({ downloadedSize, totalSize }) => {
          const percent = Math.floor((downloadedSize / (totalSize || MODEL.size)) * 100);
          if (this.downloading && percent !== this.downloading.percent) {
            this.downloading.percent = percent;
            this.emit();
          }
        },
      });
      await downloader.download();
      const { size } = await stat(this.path);
      if (size < MODEL.size * 0.95) throw new Error("O arquivo do modelo veio incompleto. Tente de novo.");
    } catch (error) {
      await rm(this.path, { force: true }).catch(() => undefined);
      this.lastError = `Não foi possível baixar o modelo. Confira a internet e o espaço em disco. (${error instanceof Error ? error.message : String(error)})`;
    } finally {
      this.downloading = null;
      this.emit();
    }
  }

  async remove(): Promise<void> {
    await this.unload();
    await rm(this.path, { force: true });
    this.lastError = null;
    this.emit();
  }

  private async unload() {
    clearTimeout(this.idleTimer);
    const model = this.model;
    this.model = null;
    this.loading = null;
    await model?.dispose().catch(() => undefined);
  }

  private async getModel(): Promise<any> {
    if (!existsSync(this.path)) throw new Error("Baixe o modelo de IA local em Configurações › IA.");
    if (this.model) return this.model;
    this.loading ??= (async () => {
      const { getLlama } = await import("node-llama-cpp");
      // GPU quando houver (Vulkan); senão CPU. Sem CUDA para manter o app leve.
      const llama = await getLlama({ gpu: "auto" });
      this.model = await llama.loadModel({ modelPath: this.path });
      this.emit();
      return this.model;
    })().catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  /** Uma geração por vez; o modelo sai da memória depois de 5 min parado. */
  private run<T>(fn: (model: any) => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      clearTimeout(this.idleTimer);
      const model = await this.getModel();
      try {
        return await fn(model);
      } finally {
        this.idleTimer = setTimeout(() => void this.unload().then(() => this.emit()), IDLE_UNLOAD_MS);
      }
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async ask(model: any, system: string, prompt: string, maxTokens: number): Promise<string> {
    const { LlamaChatSession } = await import("node-llama-cpp");
    const context = await model.createContext({ contextSize: 4096 });
    try {
      const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: system });
      const answer: string = await session.prompt(prompt, { maxTokens, temperature: 0.4, topP: 0.9 });
      return answer.trim();
    } finally {
      await context.dispose();
    }
  }

  /** Rascunho de resposta para a última mensagem do contato. Nunca envia sozinho. */
  draft(contactName: string, messages: Message[], instructions: string): Promise<string> {
    return this.run(async (model) => {
      const text = await this.ask(
        model,
        `${instructions || DEFAULT_INSTRUCTIONS}\nEscreva em português do Brasil. Responda só com o texto da mensagem, sem aspas, sem explicações e sem assinatura.`,
        `Conversa de WhatsApp com ${contactName}:\n${transcript(contactName, messages)}\n\nEscreva a minha próxima resposta para ${contactName}.`,
        220,
      );
      return text.replace(/^["“]|["”]$/g, "").trim();
    });
  }

  /** Resumo em três partes: o que aconteceu, o que o contato quer e o próximo passo. */
  summarize(contactName: string, messages: Message[]): Promise<Summary> {
    return this.run(async (model) => {
      const raw = await this.ask(
        model,
        "Você resume conversas de atendimento em português do Brasil, de forma objetiva. Use exatamente o formato pedido, com frases curtas e sem inventar fatos.",
        `Conversa de WhatsApp com ${contactName}:\n${transcript(contactName, messages)}\n\nResponda exatamente neste formato:\nRESUMO: <até 2 frases>\nPEDIDO: <o que ${contactName} quer, ou "nada pendente">\nPRÓXIMO PASSO: <o que eu devo fazer agora>`,
        260,
      );
      return parseSummary(raw);
    });
  }

  async close(): Promise<void> {
    await this.unload();
  }
}

/** Lê o formato "RESUMO: / PEDIDO: / PRÓXIMO PASSO:" com tolerância a variações do modelo. */
export function parseSummary(raw: string): Summary {
  const grab = (label: RegExp) => {
    const m = raw.match(label);
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  };
  const resumo = grab(/RESUMO\s*:\s*([\s\S]*?)(?=\n\s*PEDIDO\s*:|$)/i);
  const pedido = grab(/PEDIDO\s*:\s*([\s\S]*?)(?=\n\s*PR[ÓO]XIMO\s+PASSO\s*:|$)/i);
  const proximoPasso = grab(/PR[ÓO]XIMO\s+PASSO\s*:\s*([\s\S]*)$/i);
  return { resumo: resumo || raw.trim().slice(0, 400), pedido, proximoPasso };
}
