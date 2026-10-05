// IA local: modelo pequeno rodando no próprio PC (node-llama-cpp), sem enviar a conversa
// para fora. Baixado uma vez sob pedido; carrega na primeira geração e descarrega parado.
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "./db.ts";

export const MODELS = {
  leve: {
    name: "Leve (Qwen2.5 1.5B)",
    file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    size: 1_117_320_736,
  },
  melhor: {
    name: "Melhor (Qwen2.5 3B)",
    file: "qwen2.5-3b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
    size: 2_104_932_768,
  },
} as const;
export type ModelId = keyof typeof MODELS;

export const DEFAULT_INSTRUCTIONS =
  "Você responde pela Betinhos Executive Service, transporte executivo terrestre. Tom humano, preciso e seguro: cordial, direto, sem gírias e sem exagero. Frases curtas. Nunca invente preço, horário, placa ou nome de motorista: se faltar a informação, diga que vai confirmar.";

export type AiStatus =
  | { state: "ausente" }
  | { state: "baixando"; percent: number }
  | { state: "pronto"; loaded: boolean }
  | { state: "erro"; message: string };

export type Summary = { resumo: string; pedido: string; proximoPasso: string };

const IDLE_UNLOAD_MS = 15 * 60 * 1000;

function lastFromContact(messages: Message[]): string {
  return [...messages].reverse().find((m) => !m.fromMe && m.text.trim())?.text.slice(0, 400) ?? "";
}

function transcript(contactName: string, messages: Message[]): string {
  return messages
    .filter((m) => m.text.trim())
    .slice(-25)
    .map((m) => `${m.fromMe ? "Eu" : contactName}: ${m.text.slice(0, 600)}`)
    .join("\n");
}

export class LocalAI {
  private readonly dir: string;
  private modelId: ModelId = "melhor";
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

  private get spec() {
    return MODELS[this.modelId];
  }

  private get path() {
    return join(this.dir, this.spec.file);
  }

  get model_(): ModelId {
    return this.modelId;
  }

  /** Troca o modelo em uso; o anterior sai da memória (o arquivo fica até ser apagado). */
  async select(id: ModelId): Promise<void> {
    if (id === this.modelId) return;
    await this.unload();
    this.modelId = id;
    this.lastError = null;
    this.emit();
  }

  installed(): ModelId[] {
    return (Object.keys(MODELS) as ModelId[]).filter((id) => existsSync(join(this.dir, MODELS[id].file)));
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
        modelUri: this.spec.url,
        dirPath: this.dir,
        fileName: this.spec.file,
        showCliProgress: false,
        onProgress: ({ downloadedSize, totalSize }) => {
          const percent = Math.floor((downloadedSize / (totalSize || this.spec.size)) * 100);
          if (this.downloading && percent !== this.downloading.percent) {
            this.downloading.percent = percent;
            this.emit();
          }
        },
      });
      await downloader.download();
      const { size } = await stat(this.path);
      if (size < this.spec.size * 0.95) throw new Error("O arquivo do modelo veio incompleto. Tente de novo.");
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

  private async ask(model: any, system: string, prompt: string, maxTokens: number, temperature = 0.2): Promise<string> {
    const { LlamaChatSession } = await import("node-llama-cpp");
    const context = await model.createContext({ contextSize: 4096 });
    try {
      const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: system });
      const answer: string = await session.prompt(prompt, { maxTokens, temperature, topP: 0.9 });
      return answer.trim();
    } finally {
      await context.dispose();
    }
  }

  /** Rascunho de resposta para a última mensagem do contato. Nunca envia sozinho. */
  draft(contactName: string, messages: Message[], instructions: string): Promise<string> {
    return this.run(async (model) => {
      const conversation = transcript(contactName, messages);
      const mine = messages.filter((m) => m.fromMe).map((m) => m.text);
      const system = `${instructions || DEFAULT_INSTRUCTIONS}
Escreva em português do Brasil. Responda só com o texto da mensagem, sem aspas, sem explicações e sem assinatura.
Use apenas informações que estão na conversa. Se pedirem preço, valor, horário, placa ou motorista e isso não estiver na conversa, diga que vai confirmar e retornar. Não escreva números que não estejam na conversa.`;
      const ask = (extra: string, temperature: number) =>
        this.ask(
          model,
          system,
          `Conversa de WhatsApp com ${contactName}:\n${conversation}\n\nÚltima mensagem de ${contactName}: "${lastFromContact(messages)}"\n\nEscreva a minha próxima resposta, respondendo diretamente a essa última mensagem. Não repita o que eu já escrevi antes.${extra}`,
          200,
          temperature,
        );
      let text = (await ask("", 0.3)).replace(/^["“]|["”]$/g, "").trim();
      // Modelo pequeno às vezes só copia uma resposta minha anterior: tenta de novo proibindo-a.
      if (repeatsMine(text, mine)) {
        text = (await ask(`\nNão use estas frases, que já foram enviadas: ${mine.slice(-3).map((t) => `"${t.slice(0, 160)}"`).join("; ")}.`, 0.7))
          .replace(/^["“]|["”]$/g, "")
          .trim();
      }
      return guardDraft(text, conversation);
    });
  }

  /** Resumo em três partes: o que aconteceu, o que o contato quer e o próximo passo. */
  summarize(contactName: string, messages: Message[]): Promise<Summary> {
    return this.run(async (model) => {
      const raw = await this.ask(
        model,
        "Você resume conversas de atendimento em português do Brasil, de forma objetiva. Use exatamente o formato pedido, com frases curtas e sem inventar fatos.",
        `Conversa de WhatsApp com ${contactName}:\n${transcript(contactName, messages)}\n\nÚltima mensagem de ${contactName}: "${lastFromContact(messages)}"\n\nResponda exatamente neste formato:\nRESUMO: <até 2 frases sobre o assunto da conversa>\nPEDIDO: <o que ${contactName} está pedindo ou perguntando e ainda não foi respondido; se a última mensagem tem pergunta, é ela>\nPRÓXIMO PASSO: <a ação que eu devo fazer agora para responder>`,
        260,
      );
      return parseSummary(raw);
    });
  }

  async close(): Promise<void> {
    await this.unload();
  }
}

const PRICE = /(R\$\s*\d[\d.,]*|\b\d[\d.]*,\d{2}\b|\b\d+\s*(reais|mil)\b)/i;
const TIME = /\b([01]?\d|2[0-3])(h|:)[0-5]?\d?\b/i;
const PLATE = /\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/;
/** Pedido de dado sensível: o app nunca sugere pedir isso por WhatsApp. */
const SENSITIVE = /\b(cart[aã]o|cvv|c[oó]digo de seguran[cç]a|senha|cpf|rg|dados banc[aá]rios|n[uú]mero da conta)\b/i;
const fold = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "");

/**
 * Modelo pequeno às vezes inventa preço, horário ou placa. Toda frase do rascunho com um
 * desses dados que NÃO aparece na conversa sai, e entra um "vou confirmar".
 */
export function guardDraft(draft: string, conversation: string): string {
  const known = fold(conversation);
  let removedPrice = false;
  let removedOther = false;
  let removedSensitive = false;
  const sentences = draft.split(/(?<=[.!?])\s+/).filter((sentence) => {
    if (SENSITIVE.test(sentence) && !SENSITIVE.test(conversation)) {
      removedSensitive = true;
      return false;
    }
    for (const [re, isPrice] of [[PRICE, true], [TIME, false], [PLATE, false]] as const) {
      const m = sentence.match(re);
      if (m && !known.includes(fold(m[0]))) {
        if (isPrice) removedPrice = true;
        else removedOther = true;
        return false;
      }
    }
    return true;
  });
  let out = sentences.join(" ").trim();
  if (removedSensitive && !out) out = "Vou verificar e já te retorno.";
  if (removedPrice) out += (out ? " " : "") + "Vou confirmar o valor e já te retorno.";
  else if (removedOther) out += (out ? " " : "") + "Vou confirmar os detalhes e já te retorno.";
  return out;
}

/** O rascunho é (quase) igual a algo que eu já mandei nesta conversa? */
export function repeatsMine(draft: string, mine: string[]): boolean {
  const d = fold(draft);
  if (!d) return true;
  return mine.some((m) => {
    const t = fold(m);
    return t.length > 10 && (d === t || d.includes(t) || t.includes(d));
  });
}

/** Lê o formato "RESUMO: / PEDIDO: / PRÓXIMO PASSO:" com tolerância a variações do modelo. */
export function parseSummary(raw: string): Summary {
  const grab = (label: RegExp) => {
    const m = raw.match(label);
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  };
  // Os rótulos podem vir na mesma linha: o modelo pequeno às vezes não quebra linha.
  const resumo = grab(/RESUMO\s*:\s*([\s\S]*?)(?=\s*PEDIDO\s*:|$)/i);
  const pedido = grab(/PEDIDO\s*:\s*([\s\S]*?)(?=\s*PR[ÓO]XIMO\s+PASSO\s*:|$)/i);
  const proximoPasso = grab(/PR[ÓO]XIMO\s+PASSO\s*:\s*([\s\S]*)$/i);
  return { resumo: resumo || raw.trim().slice(0, 400), pedido, proximoPasso };
}
