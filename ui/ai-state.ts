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

/** A IA pode gerar agora? DeepSeek: basta a chave. Local: o modelo escolhido está baixado. */
export const isAiReady = (ai: AiStatus | null) =>
  !!ai && (ai.provider === "deepseek" ? ai.deepseek.configured : ai.state === "pronto");

export const aiName = (ai: AiStatus | null) => (ai?.provider === "deepseek" ? "IA" : "IA local");

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
