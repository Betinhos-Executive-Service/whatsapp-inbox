import { Check, Cpu, Download, LoaderCircle, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { api, type AiStatus } from "./api.ts";
import { gb } from "./ai-state.ts";

type ModelId = "leve" | "melhor";

const DESCRIPTION: Record<ModelId, string> = {
  leve: "Mais rápido e ocupa menos. Ótimo para resumos; rascunhos mais simples.",
  melhor: "Escreve rascunhos bem melhores. Leva cerca de 2× mais tempo por sugestão.",
};

const mb = (bytes: number) =>
  bytes >= 1024 ** 3 ? gb(bytes) : `${Math.round(bytes / 1024 ** 2).toLocaleString("pt-BR")} MB`;

function eta(seconds: number | null): string {
  if (seconds === null) return "calculando…";
  if (seconds < 60) return "menos de 1 min";
  const min = Math.round(seconds / 60);
  return min < 60 ? `cerca de ${min} min` : `cerca de ${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Cards dos modelos de IA local: baixar (com progresso real, velocidade e tempo restante),
 * cancelar e continuar depois, escolher qual usar e apagar para liberar espaço.
 */
export function AiModels({ ai, onChange }: { ai: AiStatus; onChange: (s: AiStatus) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ModelId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const downloading = ai.state === "baixando" ? ai : null;

  const act = async (key: string, fn: () => Promise<AiStatus>) => {
    setBusy(key);
    setError(null);
    try {
      onChange(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ai-models">
      {(error || ai.state === "erro") && (
        <p className="ai-models__error" role="alert">
          <TriangleAlert size={16} aria-hidden />
          {error ?? (ai.state === "erro" ? ai.message : "")}
        </p>
      )}
      <ul className="ai-models__list">
        {ai.models.map((m) => {
          const isDownloading = downloading?.id === m.id;
          const inUse = ai.modelId === m.id && m.installed;
          const state = isDownloading ? "downloading" : m.installed ? "installed" : "absent";
          return (
            <li key={m.id} className={`ai-model${inUse ? " ai-model--active" : ""}`} data-state={state}>
              <div className="ai-model__head">
                <span className="ai-model__icon" aria-hidden>
                  {m.id === "melhor" ? <Sparkles size={18} /> : <Cpu size={18} />}
                </span>
                <span className="ai-model__title">
                  <strong>{m.name}</strong>
                  <span className="hint">{DESCRIPTION[m.id]}</span>
                </span>
                {inUse ? (
                  <span className="pill pill--success ai-model__pill">
                    <Check size={12} aria-hidden /> Em uso
                  </span>
                ) : m.installed ? (
                  <span className="pill pill--neutral ai-model__pill">Baixado</span>
                ) : (
                  <span className="ai-model__size">{gb(m.size)}</span>
                )}
              </div>

              {/* A troca de estado entra com fade curto; a chave força a animação a cada mudança. */}
              <div className="ai-model__body" key={state}>
                {state === "downloading" && downloading && (
                  <>
                    <div
                      className="progress ai-model__progress"
                      role="progressbar"
                      aria-label={`Download do modelo ${m.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={downloading.percent}
                    >
                      <div className="progress__bar" style={{ transform: `scaleX(${downloading.percent / 100})` }} />
                    </div>
                    <div className="ai-model__meta" aria-live="polite">
                      <span>
                        <strong>{downloading.percent}%</strong> · {mb(downloading.downloaded)} de {mb(downloading.total)}
                      </span>
                      <span>
                        {downloading.speed > 0 ? `${mb(downloading.speed)}/s · ` : ""}
                        {eta(downloading.eta)}
                      </span>
                    </div>
                    <div className="ai-model__actions">
                      <span className="hint">Pode fechar esta janela: o download continua com o app aberto na bandeja.</span>
                      <button
                        className="button button--ghost button--compact"
                        disabled={busy === "cancel"}
                        onClick={() => void act("cancel", api.cancelAiDownload)}
                      >
                        <X size={16} aria-hidden /> Pausar
                      </button>
                    </div>
                  </>
                )}

                {state === "absent" && (
                  <div className="ai-model__actions">
                    <span className="hint">{m.partial ? "Download pausado. Continua de onde parou." : "Baixa uma vez e funciona sem internet."}</span>
                    <button
                      className={`button ${ai.models.some((x) => x.installed) ? "button--secondary" : "button--primary"} button--compact`}
                      disabled={!!downloading || busy !== null}
                      title={downloading ? "Um download por vez" : undefined}
                      aria-busy={busy === `dl-${m.id}` || undefined}
                      onClick={() => void act(`dl-${m.id}`, () => api.downloadAi(m.id))}
                    >
                      {busy === `dl-${m.id}` ? <LoaderCircle className="spin" size={16} aria-hidden /> : <Download size={16} aria-hidden />}
                      {m.partial ? "Continuar download" : `Baixar · ${gb(m.size)}`}
                    </button>
                  </div>
                )}

                {state === "installed" && (
                  <div className="ai-model__actions">
                    {confirmDelete === m.id ? (
                      <>
                        <span className="hint">Apagar libera {gb(m.size)}. Dá para baixar de novo depois.</span>
                        <span className="cluster">
                          <button className="button button--secondary button--compact" onClick={() => setConfirmDelete(null)}>
                            Manter
                          </button>
                          <button
                            className="button button--danger button--compact"
                            disabled={busy !== null}
                            onClick={() => void act(`rm-${m.id}`, () => api.removeAi(m.id)).then(() => setConfirmDelete(null))}
                          >
                            Apagar
                          </button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="hint ai-model__ready">
                          <Check size={14} aria-hidden /> {inUse ? (ai.state === "pronto" && ai.loaded ? "Pronto e carregado." : "Pronto. Carrega na primeira sugestão.") : "Baixado neste computador."}
                        </span>
                        <span className="cluster">
                          {!inUse && (
                            <button className="button button--primary button--compact" disabled={busy !== null} onClick={() => void act(`use-${m.id}`, () => api.selectAi(m.id))}>
                              Usar este
                            </button>
                          )}
                          <button className="icon-button icon-button--plain" aria-label={`Apagar o modelo ${m.name}`} onClick={() => setConfirmDelete(m.id)}>
                            <Trash2 size={16} aria-hidden />
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hint">A IA local roda neste computador: o texto das conversas não sai daqui.</p>
    </div>
  );
}
