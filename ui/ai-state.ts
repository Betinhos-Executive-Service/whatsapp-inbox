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

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
