import { Bot, ChevronDown, LoaderCircle, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AiStatus, type ClaudeEffort, type Thinking } from "./api.ts";
import { publishAi, useAiStatus } from "./ai-state.ts";

export const THINKING_LABELS: Record<Thinking, string> = { off: "Desligado", low: "Baixo", high: "Alto", max: "Máximo" };
export const EFFORT_LABELS: Record<ClaudeEffort, string> = { default: "Padrão", low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Muito alto", max: "Máximo" };

/** Rótulo curto do que está valendo: "DeepSeek V4 Pro · thinking alto". */
export function aiSummary(ai: AiStatus): string {
  if (ai.provider === "claude") {
    const model = ai.claude.models.find((m) => m.id === ai.claude.model)?.name ?? ai.claude.model;
    const effort = ai.claude.options.effort;
    return `Claude ${model}${effort === "default" ? "" : ` · esforço ${EFFORT_LABELS[effort].toLowerCase()}`}`;
  }
  const model = ai.deepseek.models.find((m) => m.id === ai.deepseek.model)?.name ?? ai.deepseek.model;
  const thinking = ai.deepseek.options.thinking;
  return `DeepSeek ${model}${thinking === "off" ? "" : ` · thinking ${THINKING_LABELS[thinking].toLowerCase()}`}`;
}

/** Botão da conversa que troca IA, modelo e raciocínio na hora (rascunho e resumo). */
export function AiQuickPicker({ onMore }: { onMore: () => void }) {
  const ai = useAiStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".ai-quick__toggle")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ai) return null;
  const run = async (fn: () => Promise<AiStatus>) => {
    setBusy(true);
    setError(null);
    try {
      publishAi(await fn());
    } catch (e) {
      setError(`Não foi possível trocar. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const ds = ai.deepseek;
  const cl = ai.claude;

  return (
    <div className="ai-quick" ref={root}>
      <button
        type="button"
        className="button button--secondary button--compact ai-quick__toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="IA usada no rascunho e no resumo"
        onClick={() => setOpen((v) => !v)}
      >
        <Bot size={16} aria-hidden />
        <span className="ai-quick__label">{aiSummary(ai)}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="ai-quick__panel" role="dialog" aria-label="Escolher IA">
          <div className="field">
            <span className="field__label">IA</span>
            <div className="segmented" role="radiogroup" aria-label="Onde a IA roda">
              {(
                [
                  ["deepseek", "DeepSeek"],
                  ["claude", "Claude"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={ai.provider === id} className="segmented__item" disabled={busy} onClick={() => ai.provider !== id && void run(() => api.setAiProvider(id))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label">Modelo</span>
            <div className="segmented" role="radiogroup" aria-label="Modelo">
              {ai.provider === "claude"
                ? cl.models.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={cl.model === m.id} className="segmented__item" disabled={busy} title={m.hint} onClick={() => cl.model !== m.id && void run(() => api.setClaudeModel(m.id))}>
                      {m.name}
                    </button>
                  ))
                : ds.models.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={ds.model === m.id} className="segmented__item" disabled={busy} title={m.hint} onClick={() => ds.model !== m.id && void run(() => api.setDeepseekModel(m.id))}>
                      {m.name}
                    </button>
                  ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label">{ai.provider === "claude" ? "Esforço" : "Thinking"}</span>
            <div className="segmented" role="radiogroup" aria-label={ai.provider === "claude" ? "Esforço do Claude" : "Thinking da DeepSeek"}>
              {ai.provider === "claude"
                ? (Object.keys(EFFORT_LABELS) as ClaudeEffort[]).map((id) => (
                    <button key={id} type="button" role="radio" aria-checked={cl.options.effort === id} className="segmented__item" disabled={busy} onClick={() => cl.options.effort !== id && void run(() => api.setClaudeOptions({ ...cl.options, effort: id }))}>
                      {EFFORT_LABELS[id]}
                    </button>
                  ))
                : (Object.keys(THINKING_LABELS) as Thinking[]).map((id) => (
                    <button key={id} type="button" role="radio" aria-checked={ds.options.thinking === id} className="segmented__item" disabled={busy} onClick={() => ds.options.thinking !== id && void run(() => api.setDeepseekOptions({ ...ds.options, thinking: id }))}>
                      {THINKING_LABELS[id]}
                    </button>
                  ))}
            </div>
          </div>
          <p className="hint">
            {ai.provider === "claude" ? `${cl.options.contextMessages} mensagens no contexto.` : `${ds.options.contextMessages} mensagens no contexto.`} Vale para rascunho e resumo, salvo na hora.
          </p>
          {error && <p className="hint hint--warning" role="alert">{error}</p>}
          <div className="split">
            {busy ? <LoaderCircle className="spin" size={16} aria-label="Salvando" /> : <span />}
            <button
              type="button"
              className="button button--ghost button--compact"
              onClick={() => {
                setOpen(false);
                onMore();
              }}
            >
              <Settings2 size={16} aria-hidden /> Todas as opções da IA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
