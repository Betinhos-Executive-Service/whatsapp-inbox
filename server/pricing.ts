// Preço estimado de cada chamada de IA, calculado na hora da chamada com a tabela pública
// de cada provedor. É estimativa: a fatura real vem da conta na DeepSeek / TypeSafe.

export type Provider = "jev" | "deepseek" | "local" | "claude";
export type UsageKind = "classificar" | "rascunho" | "resumo";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Parte da entrada que veio do cache do provedor (DeepSeek cobra 50× menos por ela). */
  cachedTokens: number;
};

/** US$ por milhão de tokens. Tabela pública consultada em 07/10/2026. */
export const RATES = {
  // TypeSafe Jev: entrada US$ 0,042/M; saída gratuita.
  jev: { input: 0.042, cached: 0.042, output: 0 },
  // DeepSeek deepseek-v4-pro (padrão), tarifa fora de pico. No pico (seg–sex 01–04h e 06–10h UTC) dobra.
  deepseek: { input: 0.66, cached: 0.022, output: 1.98 },
  local: { input: 0, cached: 0, output: 0 },
  // Claude pelo plano (Claude Code logado): sem cobrança por token, consome o limite do plano.
  claude: { input: 0, cached: 0, output: 0 },
} as const satisfies Record<Provider, { input: number; cached: number; output: number }>;

/** Tarifa de cada modelo da DeepSeek (fora de pico). Modelo desconhecido usa RATES.deepseek. */
export const DEEPSEEK_RATES: Record<string, { input: number; cached: number; output: number }> = {
  "deepseek-v4-pro": RATES.deepseek,
  "deepseek-flash": { input: 0.15, cached: 0.003, output: 0.6 },
};

/** Claude pela API da Anthropic (cobrado por token). Tabela pública consultada em 13/10/2026. */
export const CLAUDE_API_RATES: Record<string, { input: number; cached: number; output: number }> = {
  "claude-fable-5-1": { input: 10, cached: 0.25, output: 50 },
  "claude-opus-5-5": { input: 4, cached: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cached: 0.2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cached: 0.01, output: 0.5 },
};

/** Horário de pico da DeepSeek: segunda a sexta, 01:00–04:00 e 06:00–10:00 UTC. */
export function isDeepseekPeak(at = new Date()): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = at.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

export function estimateCostUsd(provider: Provider, usage: TokenUsage, at = new Date(), model?: string): number {
  const r =
    provider === "deepseek" && model ? (DEEPSEEK_RATES[model] ?? RATES.deepseek)
    : provider === "claude" && model ? (CLAUDE_API_RATES[model] ?? RATES.claude)
    : RATES[provider];
  const fresh = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const usd = (fresh * r.input + usage.cachedTokens * r.cached + usage.outputTokens * r.output) / 1_000_000;
  return provider === "deepseek" && isDeepseekPeak(at) ? usd * 2 : usd;
}

/** Cotação padrão US$→R$ quando a pessoa ainda não ajustou a sua em Configurações. */
export const DEFAULT_USD_BRL = 5.5;
