// IA na nuvem (DeepSeek): rascunho e resumo bem melhores e em segundos. O texto das últimas
// mensagens da conversa vai para a API da DeepSeek; nada de identificador do WhatsApp.
import type { Message } from "./db.ts";
import { draftPrompt, guardDraft, parseSummary, plainTranscript, summaryPrompt, unquote, type Prompt, type Summary } from "./ai.ts";

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const ENDPOINT = "https://api.deepseek.com/chat/completions";
const TIMEOUT_MS = 30_000;

type Fetch = typeof fetch;

export class DeepSeekAI {
  private readonly fetchImpl: Fetch;

  constructor(fetchImpl: Fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  private async complete(apiKey: string, { system, user }: Prompt, maxTokens: number, temperature: number): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // Sem "thinking": resposta direta em poucos segundos.
          thinking: { type: "disabled" },
          max_tokens: maxTokens,
          temperature,
          stream: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new Error(timedOut ? "A DeepSeek demorou demais para responder. Tente de novo." : "Sem conexão com a DeepSeek. Confira a internet.");
    }
    const data = (await res.json().catch(() => null)) as
      | { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
      | null;
    if (!res.ok) {
      const detail = data?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 401) throw new Error("Chave da DeepSeek inválida. Confira em Configurações › IA.");
      if (res.status === 402) throw new Error("Sem saldo na DeepSeek. Recarregue a conta em platform.deepseek.com.");
      if (res.status === 429) throw new Error("Muitos pedidos à DeepSeek agora. Tente de novo em instantes.");
      throw new Error(`A DeepSeek não respondeu (${detail}).`);
    }
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("A DeepSeek devolveu uma resposta vazia. Tente de novo.");
    return text;
  }

  /** Rascunho de resposta para a última mensagem do contato. Nunca envia sozinho. */
  async draft(apiKey: string, contactName: string, messages: Message[], instructions: string): Promise<string> {
    const text = unquote(await this.complete(apiKey, draftPrompt(contactName, messages, instructions, true), 400, 0.5));
    return guardDraft(text, plainTranscript(contactName, messages));
  }

  async summarize(apiKey: string, contactName: string, messages: Message[]): Promise<Summary> {
    return parseSummary(await this.complete(apiKey, summaryPrompt(contactName, messages, true), 400, 0.2));
  }
}
