import { useEffect, useState } from "react";
import { api, type AiStatus } from "./api.ts";

// Um único estado para o app inteiro: abrir conversa não refaz a consulta ao servidor.
let latest: AiStatus | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(s: AiStatus) => void>();
/** Resposta de uma ação da IA (trocar modelo etc.) vale para todas as telas. */
export const publishAi = (s: AiStatus) => {
  latest = s;
  for (const fn of listeners) fn(s);
};
window.addEventListener("inbox:ai", (e) => publishAi((e as CustomEvent<AiStatus>).detail));

/** Estado da IA: carrega uma vez e acompanha o evento "ai" do servidor. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(latest);
  useEffect(() => {
    listeners.add(setStatus);
    if (latest) setStatus(latest);
    else loading ??= api.ai().then(publishAi).catch(() => undefined).finally(() => (loading = null));
    return () => void listeners.delete(setStatus);
  }, []);
  return status;
}

/** A IA pode gerar agora? DeepSeek: basta a chave. Claude: o Claude Code está instalado. */
export const isAiReady = (ai: AiStatus | null) => !!ai && (ai.provider === "claude" ? ai.claude.configured : ai.deepseek.configured);

export const aiName = (ai: AiStatus | null) => (ai?.provider === "claude" ? "Claude" : "IA");

// Cotação US$→R$ usada para mostrar o custo da IA em reais. Carregada uma vez; o painel de
// gastos avisa (evento) quando a pessoa troca a cotação.
const DEFAULT_USD_BRL = 5.5;
let rate: number | null = null;
let rateLoading: Promise<void> | null = null;
const rateListeners = new Set<(r: number) => void>();
export const publishUsdBrl = (r: number) => {
  rate = r;
  for (const fn of rateListeners) fn(r);
};
export function useUsdBrl(): number {
  const [value, setValue] = useState(rate ?? DEFAULT_USD_BRL);
  useEffect(() => {
    rateListeners.add(setValue);
    if (rate !== null) setValue(rate);
    else rateLoading ??= api.aiUsage(1).then((s) => publishUsdBrl(s.usdBrl)).catch(() => undefined).finally(() => (rateLoading = null));
    return () => void rateListeners.delete(setValue);
  }, []);
  return value;
}

