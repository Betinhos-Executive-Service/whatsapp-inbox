import { Bot, ChevronDown, LoaderCircle, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AiStatus, type ClaudeEffort, type ClaudeModel, type DeepSeekModel, type Thinking } from "./api.ts";
import { publishAi, useAiStatus } from "./ai-state.ts";
import { Button, SegmentedControl, Select } from "./ds/index.ts";

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
      <Button
        variant="secondary"
        size="compact"
        className="ai-quick__toggle"
        icon={<Bot size={16} aria-hidden />}
        iconEnd={<ChevronDown size={14} aria-hidden />}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="IA usada no rascunho e no resumo"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ai-quick__label">{aiSummary(ai)}</span>
      </Button>
      {open && (
        <div className="ai-quick__panel" role="dialog" aria-label="Escolher IA">
          <div className="field">
            <span className="field__label">IA</span>
            <SegmentedControl<AiStatus["provider"]>
              aria-label="Onde a IA roda"
              size="compact"
              options={[
                { value: "deepseek", label: "DeepSeek", disabled: busy },
                { value: "claude", label: "Claude", disabled: busy },
              ]}
              value={ai.provider}
              onChange={(id) => ai.provider !== id && void run(() => api.setAiProvider(id))}
            />
          </div>
          <div className="field">
            <span className="field__label">Modelo</span>
            {ai.provider === "claude" ? (
              <Select
                aria-label="Modelo"
                size="compact"
                searchable={false}
                clearable={false}
                disabled={busy}
                options={cl.models.map((m) => ({ value: m.id, label: m.name, subtitle: m.hint }))}
                value={cl.model}
                onChange={(id) => id && cl.model !== id && void run(() => api.setClaudeModel(id as ClaudeModel))}
              />
            ) : (
              <Select
                aria-label="Modelo"
                size="compact"
                searchable={false}
                clearable={false}
                disabled={busy}
                options={ds.models.map((m) => ({ value: m.id, label: m.name, subtitle: m.hint }))}
                value={ds.model}
                onChange={(id) => id && ds.model !== id && void run(() => api.setDeepseekModel(id as DeepSeekModel))}
              />
            )}
          </div>
          <div className="field">
            <span className="field__label">{ai.provider === "claude" ? "Esforço" : "Thinking"}</span>
            {ai.provider === "claude" ? (
              <Select
                aria-label="Esforço do Claude"
                size="compact"
                searchable={false}
                clearable={false}
                disabled={busy}
                options={(Object.keys(EFFORT_LABELS) as ClaudeEffort[]).map((id) => ({ value: id, label: EFFORT_LABELS[id] }))}
                value={cl.options.effort}
                onChange={(id) => id && cl.options.effort !== id && void run(() => api.setClaudeOptions({ ...cl.options, effort: id as ClaudeEffort }))}
              />
            ) : (
              <SegmentedControl<Thinking>
                aria-label="Thinking da DeepSeek"
                size="compact"
                options={(Object.keys(THINKING_LABELS) as Thinking[]).map((id) => ({ value: id, label: THINKING_LABELS[id], disabled: busy }))}
                value={ds.options.thinking}
                onChange={(id) => ds.options.thinking !== id && void run(() => api.setDeepseekOptions({ ...ds.options, thinking: id }))}
              />
            )}
          </div>
          <p className="hint">
            {ai.provider === "claude" ? `${cl.options.contextMessages} mensagens no contexto.` : `${ds.options.contextMessages} mensagens no contexto.`} Vale para rascunho e resumo, salvo na hora.
          </p>
          {error && <p className="hint hint--warning" role="alert">{error}</p>}
          <div className="split">
            {busy ? <LoaderCircle className="spin" size={16} aria-label="Salvando" /> : <span />}
            <Button
              variant="ghost"
              size="compact"
              icon={<Settings2 size={16} aria-hidden />}
              onClick={() => {
                setOpen(false);
                onMore();
              }}
            >
              Todas as opções da IA
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
