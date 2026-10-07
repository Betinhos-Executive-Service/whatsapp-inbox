// IA local: modelo pequeno rodando no próprio PC (node-llama-cpp), sem enviar a conversa
// para fora. Baixado uma vez sob pedido; carrega na primeira geração e descarrega parado.
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "./db.ts";
import type { TokenUsage } from "./pricing.ts";

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
  | { state: "baixando"; id: ModelId; percent: number; downloaded: number; total: number; speed: number; eta: number | null }
  | { state: "pronto"; loaded: boolean }
  | { state: "erro"; message: string };

export type Summary = { resumo: string; pedido: string; proximoPasso: string };

const IDLE_UNLOAD_MS = 15 * 60 * 1000;

function lastFromContact(messages: Message[]): string {
  return [...messages].reverse().find((m) => !m.fromMe && m.text.trim())?.text.slice(0, 400) ?? "";
}

/** Janela de conversa enviada ao modelo: quantas mensagens recentes e quantos caracteres por mensagem. */
export type Window = { messages: number; chars: number };
/** Janela padrão (modelo local, contexto pequeno). A nuvem passa uma janela maior. */
export const DEFAULT_WINDOW: Window = { messages: 40, chars: 600 };

function transcript(contactName: string, messages: Message[], withTime = false, window: Window = DEFAULT_WINDOW): string {
  const when = (at: number) =>
    new Date(at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return messages
    .filter((m) => m.text.trim())
    .slice(-window.messages)
    .map((m) => `${withTime ? `[${when(m.at)}] ` : ""}${m.fromMe ? "Eu" : contactName}: ${m.text.slice(0, window.chars)}`)
    .join("\n");
}

export type Prompt = { system: string; user: string };

const DRAFT_RULES = `Escreva em português do Brasil. Responda só com o texto da mensagem, sem aspas, sem explicações e sem assinatura.
Use apenas informações que estão na conversa. Se pedirem preço, valor, horário, placa ou motorista e isso não estiver na conversa, diga que vai confirmar e retornar. Não escreva números que não estejam na conversa.
Acompanhe o tom da conversa: com amigos e família, informal e curto; com clientes, cordial e profissional.`;

/** Pedido de rascunho. withTime: data/hora em cada mensagem (o modelo da nuvem usa bem; o local se confunde). */
export function draftPrompt(contactName: string, messages: Message[], instructions: string, withTime = false, window: Window = DEFAULT_WINDOW): Prompt {
  return {
    system: `${instructions || DEFAULT_INSTRUCTIONS}\n${DRAFT_RULES}`,
    user: `Conversa de WhatsApp com ${contactName}${withTime ? " (mais antigas primeiro; as últimas são as que importam)" : ""}:\n${transcript(contactName, messages, withTime, window)}\n\nÚltima mensagem de ${contactName}: "${lastFromContact(messages)}"\n\nEscreva a minha próxima resposta, respondendo diretamente a essa última mensagem. Não repita o que eu já escrevi antes.`,
  };
}

export function summaryPrompt(contactName: string, messages: Message[], withTime = false, window: Window = DEFAULT_WINDOW): Prompt {
  return {
    system:
      "Você resume conversas de atendimento em português do Brasil, de forma objetiva. Use exatamente o formato pedido, com frases curtas e sem inventar fatos. O assunto atual é o das mensagens mais recentes; assuntos antigos já encerrados não entram no pedido nem no próximo passo.",
    user: `Conversa de WhatsApp com ${contactName}${withTime ? " (mais antigas primeiro)" : ""}:\n${transcript(contactName, messages, withTime, window)}\n\nÚltima mensagem de ${contactName}: "${lastFromContact(messages)}"\n\nResponda exatamente neste formato:\nRESUMO: <até 2 frases sobre o assunto atual da conversa>\nPEDIDO: <o que ${contactName} está pedindo ou perguntando e ainda não foi respondido; se nada estiver pendente, escreva "nada pendente">\nPRÓXIMO PASSO: <a ação que eu devo fazer agora, ou "nenhuma ação necessária">`,
  };
}

/** Tira as aspas que o modelo às vezes põe em volta do rascunho. */
export const unquote = (text: string) => text.replace(/^["“]|["”]$/g, "").trim();

/** Conversa sem horários, para a trava do rascunho (horário de envio não conta como dado citado). */
export const plainTranscript = (contactName: string, messages: Message[], window: Window = DEFAULT_WINDOW) => transcript(contactName, messages, false, window);

export class LocalAI {
  private readonly dir: string;
  private modelId: ModelId = "melhor";
  private readonly onStatus: (s: AiStatus) => void;
  private downloading: {
    id: ModelId;
    percent: number;
    downloaded: number;
    total: number;
    speed: number;
    eta: number | null;
    cancel: (() => Promise<void>) | null;
  } | null = null;
  private cancelled = false;
  /** Modelo que acabou de baixar (a tela mostra a confirmação uma vez). */
  justFinished: ModelId | null = null;
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
    if (this.downloading) {
      const { id, percent, downloaded, total, speed, eta } = this.downloading;
      return { state: "baixando", id, percent, downloaded, total, speed: Math.round(speed), eta };
    }
    if (this.lastError) return { state: "erro", message: this.lastError };
    return existsSync(this.path) ? { state: "pronto", loaded: !!this.model } : { state: "ausente" };
  }

  private emit() {
    this.onStatus(this.status());
  }

  /**
   * Baixa um modelo em segundo plano. O progresso (bytes, velocidade, tempo restante) sai por
   * onStatus no máximo 4×/s. Cancelar guarda o pedaço baixado: baixar de novo continua dali.
   */
  async download(id: ModelId = this.modelId): Promise<void> {
    if (this.downloading || existsSync(join(this.dir, MODELS[id].file))) return;
    const spec = MODELS[id];
    this.lastError = null;
    this.downloading = { id, percent: 0, downloaded: 0, total: spec.size, speed: 0, eta: null, cancel: null };
    this.emit();
    try {
      await mkdir(this.dir, { recursive: true });
      const { createModelDownloader } = await import("node-llama-cpp");
      let lastAt = Date.now();
      let lastBytes = 0;
      let lastEmit = 0;
      const downloader = await createModelDownloader({
        modelUri: spec.url,
        dirPath: this.dir,
        fileName: spec.file,
        showCliProgress: false,
        deleteTempFileOnCancel: false,
        onProgress: ({ downloadedSize, totalSize }) => {
          const d = this.downloading;
          if (!d) return;
          const now = Date.now();
          if (now - lastAt >= 1000) {
            // média móvel: a velocidade não pula a cada pacote
            const instant = ((downloadedSize - lastBytes) * 1000) / (now - lastAt);
            d.speed = d.speed ? d.speed * 0.7 + instant * 0.3 : instant;
            lastAt = now;
            lastBytes = downloadedSize;
          }
          d.downloaded = downloadedSize;
          d.total = totalSize || spec.size;
          d.percent = Math.min(100, Math.floor((downloadedSize / d.total) * 100));
          d.eta = d.speed > 0 ? Math.round((d.total - downloadedSize) / d.speed) : null;
          if (now - lastEmit >= 250) {
            lastEmit = now;
            this.emit();
          }
        },
      });
      this.downloading.cancel = () => downloader.cancel({ deleteTempFile: false });
      // Pausa pedida enquanto a conexão abria: atende agora.
      if (this.cancelled) await downloader.cancel({ deleteTempFile: false });
      else await downloader.download();
      if (this.cancelled) throw new Error("pausado");
      const { size } = await stat(join(this.dir, spec.file));
      if (size < spec.size * 0.95) throw new Error("O arquivo do modelo veio incompleto. Tente de novo.");
      this.justFinished = id;
      // Primeiro modelo baixado (ou o escolhido ainda não existe): passa a usar este.
      if (!existsSync(this.path)) this.modelId = id;
    } catch (error) {
      if (this.cancelled) {
        this.cancelled = false;
      } else {
        this.lastError = `Não foi possível baixar. Confira a internet e o espaço em disco; baixar de novo continua de onde parou. (${error instanceof Error ? error.message : String(error)})`;
      }
    } finally {
      this.downloading = null;
      this.emit();
    }
  }

  async cancelDownload(): Promise<void> {
    if (!this.downloading) return;
    this.cancelled = true;
    await this.downloading.cancel?.();
  }

  async remove(id: ModelId = this.modelId): Promise<void> {
    if (id === this.modelId) await this.unload();
    await rm(join(this.dir, MODELS[id].file), { force: true });
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
      const sequence = context.getSequence();
      const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system });
      const answer: string = await session.prompt(prompt, { maxTokens, temperature, topP: 0.9 });
      this.lastUsage.inputTokens += Number(sequence.tokenMeter?.usedInputTokens ?? 0);
      this.lastUsage.outputTokens += Number(sequence.tokenMeter?.usedOutputTokens ?? 0);
      return answer.trim();
    } finally {
      await context.dispose();
    }
  }

  /** Tokens somados pelas chamadas a ask() dentro de uma geração; zerado no começo de cada uma. */
  private lastUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  private takeUsage(): TokenUsage {
    const u = this.lastUsage;
    this.lastUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    return u;
  }

  /** Rascunho de resposta para a última mensagem do contato. Nunca envia sozinho. */
  draft(contactName: string, messages: Message[], instructions: string): Promise<{ text: string; usage: TokenUsage }> {
    return this.run(async (model) => {
      this.takeUsage();
      // O modelo local se perde com conversa longa: só as 25 últimas.
      const recent = messages.slice(-25);
      const { system, user } = draftPrompt(contactName, recent, instructions);
      const mine = recent.filter((m) => m.fromMe).map((m) => m.text);
      let text = unquote(await this.ask(model, system, user, 200, 0.3));
      // Modelo pequeno às vezes só copia uma resposta minha anterior: tenta de novo proibindo-a.
      if (repeatsMine(text, mine)) {
        const extra = `\nNão use estas frases, que já foram enviadas: ${mine.slice(-3).map((t) => `"${t.slice(0, 160)}"`).join("; ")}.`;
        text = unquote(await this.ask(model, system, user + extra, 200, 0.7));
      }
      return { text: guardDraft(text, transcript(contactName, recent)), usage: this.takeUsage() };
    });
  }

  /** Resumo em três partes: o que aconteceu, o que o contato quer e o próximo passo. */
  summarize(contactName: string, messages: Message[]): Promise<{ summary: Summary; usage: TokenUsage }> {
    return this.run(async (model) => {
      this.takeUsage();
      const { system, user } = summaryPrompt(contactName, messages.slice(-25));
      const summary = parseSummary(await this.ask(model, system, user, 260));
      return { summary, usage: this.takeUsage() };
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
