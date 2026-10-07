import { useEffect, useState } from "react";
import { api, type AiStatus, type ClaudeEffort, type ClaudeOptions, type DeepSeekOptions, type DeepSeekTask, type Thinking } from "./api.ts";
import { EFFORT_LABELS } from "./ai-quick.tsx";
import { Button, Input, SegmentedControl } from "./ds/index.ts";

const EFFORT_HINTS: Record<ClaudeEffort, string> = {
  default: "Usa o esforço configurado no Claude Code deste PC.",
  low: "Responde mais rápido e gasta menos do limite do plano.",
  medium: "Equilíbrio entre tempo e cuidado.",
  high: "Pensa mais antes de responder. Mais lento.",
  xhigh: "Raciocínio longo. Pode passar de alguns minutos.",
  max: "O máximo de raciocínio. Lento e gasta bem mais do limite do plano.",
};

const THINKING: { id: Thinking; label: string; hint: string }[] = [
  { id: "off", label: "Desligado", hint: "Modo rápido: resposta direta em poucos segundos. Mais barato." },
  { id: "low", label: "Baixo", hint: "Pensa um pouco antes de responder. Alguns segundos a mais." },
  { id: "high", label: "Alto", hint: "Raciocínio completo. Mais lento e gasta mais tokens de saída." },
  { id: "max", label: "Máximo", hint: "Raciocínio mais longo possível. Pode levar minutos e custa bem mais." },
];

const TASKS: { id: DeepSeekTask; label: string }[] = [
  { id: "draft", label: "Rascunho de resposta" },
  { id: "summary", label: "Resumo" },
  { id: "classify", label: "Classificação" },
];

/** Campo numérico que só grava ao sair do campo (ou Enter); valor fora da faixa volta ao anterior. */
export function NumberField({ label, value, min, max, step, hint, disabled, onCommit, hideLabel }: {
  hideLabel?: boolean;
  label: string; value: number; min: number; max: number; step: number; hint?: string; disabled: boolean; onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) return setText(String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <label className="field">
      <span className={`field__label${hideLabel ? " sr-only" : ""}`}>{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function DeepSeekOptionsPanel({ ai, onChange }: { ai: AiStatus; onChange: (ai: AiStatus) => void }) {
  const o = ai.deepseek.options;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: DeepSeekOptions | null) => {
    setSaving(true);
    setError(null);
    try {
      onChange(await api.setDeepseekOptions(next));
    } catch (e) {
      setError(`Não foi possível salvar. ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const patch = (p: Partial<DeepSeekOptions>) => void save({ ...o, ...p });
  const isDefault = JSON.stringify(o) === JSON.stringify(ai.deepseek.defaults);
  const thinking = THINKING.find((t) => t.id === o.thinking)!;
  return (
    <div className="stack ai-options">
      <div className="field">
        <span className="field__label">Thinking (raciocínio)</span>
        <SegmentedControl<Thinking>
          aria-label="Esforço de raciocínio"
          size="compact"
          options={THINKING.map((t) => ({ value: t.id, label: t.label, disabled: saving }))}
          value={o.thinking}
          onChange={(id) => o.thinking !== id && patch({ thinking: id })}
        />
        <span className="hint">
          {thinking.hint}
          {o.thinking !== "off" && " Com thinking ligado, a temperatura é ignorada pela DeepSeek."}
        </span>
      </div>

      <div className="ai-options__grid">
        <NumberField
          label="Mensagens no contexto"
          value={o.contextMessages}
          min={10}
          max={1000}
          step={10}
          disabled={saving}
          hint="Últimas mensagens da conversa enviadas (10 a 1000)."
          onCommit={(v) => patch({ contextMessages: Math.round(v) })}
        />
        <NumberField
          label="Caracteres por mensagem"
          value={o.messageChars}
          min={100}
          max={10000}
          step={100}
          disabled={saving}
          hint="Mensagens maiores são cortadas (100 a 10000)."
          onCommit={(v) => patch({ messageChars: Math.round(v) })}
        />
      </div>

      <table className="ai-options__tasks">
        <caption className="field__label">Limites por tarefa</caption>
        <thead>
          <tr>
            <th scope="col">Tarefa</th>
            <th scope="col">Máx. tokens de resposta</th>
            <th scope="col">Temperatura</th>
          </tr>
        </thead>
        <tbody>
          {TASKS.map((t) => (
            <tr key={t.id}>
              <th scope="row">{t.label}</th>
              <td>
                <NumberField hideLabel label={`Máximo de tokens: ${t.label}`} value={o[t.id].maxTokens} min={50} max={8000} step={50} disabled={saving} onCommit={(v) => patch({ [t.id]: { ...o[t.id], maxTokens: Math.round(v) } })} />
              </td>
              <td>
                <NumberField hideLabel label={`Temperatura: ${t.label}`} value={o[t.id].temperature} min={0} max={2} step={0.1} disabled={saving || o.thinking !== "off"} onCommit={(v) => patch({ [t.id]: { ...o[t.id], temperature: Math.round(v * 100) / 100 } })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="hint">
        Temperatura baixa (0 a 0,3) deixa a resposta previsível; alta (acima de 1) fica mais criativa.
        {o.thinking !== "off" && " Com thinking, o app reserva tokens extras para o raciocínio além do máximo da resposta."}
      </span>
      {error && <p className="hint hint--warning" role="alert">{error}</p>}
      <div>
        <Button variant="secondary" size="compact" disabled={saving || isDefault} onClick={() => void save(null)}>
          Restaurar padrão
        </Button>
      </div>
    </div>
  );
}

/** Opções do Claude pelo plano: esforço e janela da conversa. Salvas na hora. */
export function ClaudeOptionsPanel({ ai, onChange }: { ai: AiStatus; onChange: (ai: AiStatus) => void }) {
  const o = ai.claude.options;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: ClaudeOptions | null) => {
    setSaving(true);
    setError(null);
    try {
      onChange(await api.setClaudeOptions(next));
    } catch (e) {
      setError(`Não foi possível salvar. ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const patch = (p: Partial<ClaudeOptions>) => void save({ ...o, ...p });
  const isDefault = JSON.stringify(o) === JSON.stringify(ai.claude.defaults);
  return (
    <div className="stack ai-options">
      <div className="field">
        <span className="field__label">Esforço (raciocínio)</span>
        <SegmentedControl<ClaudeEffort>
          aria-label="Esforço do Claude"
          size="compact"
          options={(Object.keys(EFFORT_LABELS) as ClaudeEffort[]).map((id) => ({ value: id, label: EFFORT_LABELS[id], disabled: saving }))}
          value={o.effort}
          onChange={(id) => o.effort !== id && patch({ effort: id })}
        />
        <span className="hint">{EFFORT_HINTS[o.effort]}</span>
      </div>
      <div className="ai-options__grid">
        <NumberField
          label="Mensagens no contexto"
          value={o.contextMessages}
          min={10}
          max={1000}
          step={10}
          disabled={saving}
          hint="Últimas mensagens da conversa enviadas (10 a 1000)."
          onCommit={(v) => patch({ contextMessages: Math.round(v) })}
        />
        <NumberField
          label="Caracteres por mensagem"
          value={o.messageChars}
          min={100}
          max={10000}
          step={100}
          disabled={saving}
          hint="Mensagens maiores são cortadas (100 a 10000)."
          onCommit={(v) => patch({ messageChars: Math.round(v) })}
        />
      </div>
      {error && <p className="hint hint--warning" role="alert">{error}</p>}
      <div>
        <Button variant="secondary" size="compact" disabled={saving || isDefault} onClick={() => void save(null)}>
          Restaurar padrão
        </Button>
      </div>
    </div>
  );
}

/** Janela de mensagens que o Jev recebe para classificar. Salva na hora. */
export function JevContextField({ ai, onChange }: { ai: AiStatus; onChange: (ai: AiStatus) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (n: number) => {
    setSaving(true);
    setError(null);
    try {
      onChange(await api.setJevContext(n));
    } catch (e) {
      setError(`Não foi possível salvar. ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <NumberField
        label="Mensagens enviadas ao Jev"
        value={ai.jev.contextMessages}
        min={10}
        max={100}
        step={5}
        disabled={saving}
        hint="Últimas mensagens da conversa usadas na classificação pelo Jev (10 a 100). Salvo na hora."
        onCommit={(v) => void save(Math.round(v))}
      />
      {error && <p className="hint hint--warning" role="alert">{error}</p>}
    </>
  );
}
