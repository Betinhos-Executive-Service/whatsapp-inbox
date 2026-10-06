import { useEffect, useState } from "react";
import { api, type AiStatus } from "./api.ts";

/** Estado da IA local: carrega uma vez e acompanha o evento "ai" do servidor. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    api.ai().then(setStatus).catch(() => undefined);
    const onAi = (e: Event) => setStatus((e as CustomEvent<AiStatus>).detail);
    window.addEventListener("inbox:ai", onAi);
    return () => window.removeEventListener("inbox:ai", onAi);
  }, []);
  return status;
}

/** A IA pode gerar agora? DeepSeek: basta a chave. Local: o modelo escolhido está baixado. */
export const isAiReady = (ai: AiStatus | null) =>
  !!ai && (ai.provider === "deepseek" ? ai.deepseek.configured : ai.state === "pronto");

export const aiName = (ai: AiStatus | null) => (ai?.provider === "deepseek" ? "IA" : "IA local");

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
