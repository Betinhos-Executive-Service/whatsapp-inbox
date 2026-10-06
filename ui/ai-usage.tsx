import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AiUsageSummary } from "./api.ts";
import { publishUsdBrl } from "./ai-state.ts";
import { formatBrl, formatCount, formatTokens, formatUsd, percent } from "./format.ts";

type Period = 7 | 30 | null;
const PERIODS: { id: Period; label: string }[] = [
  { id: 7, label: "7 dias" },
  { id: 30, label: "30 dias" },
  { id: null, label: "Tudo" },
];
const KIND_LABEL = { classificar: "Classificação (Jev)", rascunho: "Rascunho de resposta", resumo: "Resumo da conversa" } as const;
const PROVIDER_LABEL = { jev: "Jev (TypeSafe)", deepseek: "DeepSeek", local: "IA local" } as const;

const dayShort = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
const dayOf = (key: string) => dayShort.format(new Date(`${key}T12:00:00-03:00`));

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <strong className="kpi__value">{value}</strong>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Lista de barras horizontais: rótulo, barra proporcional ao maior valor e número à direita. */
function Bars({ rows, unit }: { rows: { key: string; label: string; value: number; text: string; extra?: string }[]; unit: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="bars" aria-label={unit}>
      {rows.map((r) => (
        <li key={r.key} className="bars__row">
          <span className="bars__label" title={r.label}>{r.label}</span>
          <span className="bars__track" aria-hidden>
            <span className="bars__fill" style={{ width: max > 0 ? `${Math.max(2, (r.value / max) * 100)}%` : "0%" }} />
          </span>
          <span className="bars__value">
            {r.text}
            {r.extra && <span className="hint"> {r.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Painel "Gastos com IA" das Configurações: tokens, custo estimado e como foram as classificações. */
export function AiUsagePanel({ notify }: { notify: (kind: "error" | "success", text: string) => void }) {
  const [period, setPeriod] = useState<Period>(30);
  const [data, setData] = useState<AiUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .aiUsage(period)
      .then((d) => {
        if (!alive) return;
        setData(d);
        publishUsdBrl(d.usdBrl);
        setRate(d.usdBrl.toFixed(2).replace(".", ","));
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [period]);

  const saveRate = async () => {
    const value = Number(rate.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      notify("error", "Informe a cotação do dólar em reais, ex.: 5,50.");
      return;
    }
    setSavingRate(true);
    try {
      await api.setAiUsageRate(value);
      const d = await api.aiUsage(period);
      setData(d);
      publishUsdBrl(d.usdBrl);
      notify("success", "Cotação salva. Os valores em reais foram recalculados.");
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setSavingRate(false);
    }
  };

  const brl = (usd: number) => formatBrl(usd * (data?.usdBrl ?? 0));
  const t = data?.totals;
  const cls = data?.classification;
  const periodLabel = period === null ? "desde o início" : `nos últimos ${period} dias`;

  return (
    <div className="stack">
      <div className="split">
        <div className="segmented" role="radiogroup" aria-label="Período">
          {PERIODS.map((p) => (
            <button key={String(p.id)} type="button" role="radio" aria-checked={period === p.id} className="segmented__item" onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {!data && !error && <LoaderCircle className="spin" size={16} aria-hidden />}
      </div>

      {error && (
        <p className="alert alert--danger" role="alert">
          {error}
        </p>
      )}

      {data && t && cls && (
        <>
          <div className="kpis">
            <Kpi label="Custo estimado" value={brl(t.costUsd)} hint={`${formatUsd(t.costUsd)} ${periodLabel}`} />
            <Kpi label="Tokens" value={formatCount(t.inputTokens + t.outputTokens)} hint={`${formatTokens(t.inputTokens)} entrada · ${formatTokens(t.outputTokens)} saída`} />
            <Kpi label="Chamadas" value={String(t.calls)} hint={t.failures ? `${t.failures} com falha` : "nenhuma falha"} />
            <Kpi label="Custo por chamada" value={t.calls ? brl(t.costUsd / t.calls) : "—"} hint={t.cachedTokens ? `${formatTokens(t.cachedTokens)} em cache (mais barato)` : undefined} />
          </div>

          {t.calls === 0 ? (
            <p className="hint">Nenhuma chamada de IA {periodLabel}. Classificações, rascunhos e resumos aparecem aqui assim que forem usados.</p>
          ) : (
            <>
              <section className="stack">
                <h4 className="eyebrow">Por dia</h4>
                <Bars unit="Custo por dia" rows={data.byDay.slice(-31).map((d) => ({ key: d.day, label: dayOf(d.day), value: d.costUsd, text: brl(d.costUsd), extra: `${d.calls}×` }))} />
              </section>

              <div className="usage-grid">
                <section className="stack">
                  <h4 className="eyebrow">Por uso</h4>
                  <Bars unit="Custo por tipo de uso" rows={data.byKind.map((k) => ({ key: k.kind, label: KIND_LABEL[k.kind], value: k.costUsd, text: brl(k.costUsd), extra: `${k.calls}× · ${formatTokens(k.tokens)}` }))} />
                </section>
                <section className="stack">
                  <h4 className="eyebrow">Por provedor</h4>
                  <Bars unit="Custo por provedor" rows={data.byProvider.map((p) => ({ key: p.provider, label: PROVIDER_LABEL[p.provider], value: p.costUsd, text: brl(p.costUsd), extra: `${p.calls}× · ${formatTokens(p.tokens)}` }))} />
                </section>
              </div>

              <section className="stack">
                <h4 className="eyebrow">Classificações do Jev</h4>
                {cls.total === 0 ? (
                  <p className="hint">Nenhuma classificação {periodLabel}.</p>
                ) : (
                  <>
                    <div className="kpis kpis--compact">
                      <Kpi label="Classificadas" value={String(cls.total - cls.failures)} hint={cls.failures ? `${cls.failures} falharam` : undefined} />
                      <Kpi label="Confiança média" value={cls.avgConfidence === null ? "—" : percent(cls.avgConfidence)} />
                      <Kpi label="Pediam resposta" value={cls.needsReplyShare === null ? "—" : percent(cls.needsReplyShare)} />
                      <Kpi label="Urgentes" value={cls.urgentShare === null ? "—" : percent(cls.urgentShare)} />
                    </div>
                    <Bars
                      unit="Conversas por etiqueta"
                      rows={cls.byLabel.map((l) => ({ key: l.label, label: l.label, value: l.count, text: `${l.count}`, extra: `confiança ${percent(l.avgConfidence)}` }))}
                    />
                  </>
                )}
              </section>

              {data.topChats.length > 0 && (
                <section className="stack">
                  <h4 className="eyebrow">Conversas que mais usaram IA</h4>
                  <Bars unit="Custo por conversa" rows={data.topChats.map((c) => ({ key: c.jid, label: c.name, value: c.costUsd, text: brl(c.costUsd), extra: `${c.calls}×` }))} />
                </section>
              )}
            </>
          )}

          <section className="stack">
            <h4 className="eyebrow">Cotação do dólar</h4>
            <div className="notes__custom">
              <label className="field">
                <span className="sr-only">Cotação US$ em R$</span>
                <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-describedby="usd-brl-help" />
              </label>
              <button type="button" className="button button--secondary button--compact" disabled={savingRate} aria-busy={savingRate || undefined} onClick={() => void saveRate()}>
                {savingRate && <LoaderCircle className="spin" size={16} aria-hidden />}
                Salvar
              </button>
            </div>
            <p id="usd-brl-help" className="hint">
              Estimativa com a tabela pública: Jev US$ 0,042 por milhão de tokens de entrada; DeepSeek US$ 0,15 por milhão na entrada, US$ 0,003 em cache e US$ 0,60 na saída (dobra no horário de pico, de madrugada no Brasil). A IA local não custa nada. O valor exato é o da fatura de cada serviço.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
