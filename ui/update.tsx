import { Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { UpdateState } from "./desktop.ts";

/**
 * Aviso de versão nova, só no app desktop. Aparece toda vez que a pessoa entra no app
 * (abre ou volta pela bandeja) enquanto houver versão nova; "Depois" fecha até a próxima entrada.
 */
export function UpdateDialog() {
  const desktop = window.desktop;
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!desktop) return;
    void desktop.getUpdate().then(setState);
    const offUpdate = desktop.onUpdate(setState);
    const offRemind = desktop.onRemind(() => setDismissed(false));
    return () => {
      offUpdate();
      offRemind();
    };
  }, [desktop]);

  const busy = state.status === "downloading" || state.status === "installing";
  // "checking" e "latest" vêm do botão das Configurações; aviso só quando há o que fazer.
  const actionable = ["available", "downloading", "installing", "error"].includes(state.status) && !(state.status === "error" && !state.version);
  const open = !!desktop && actionable && (!dismissed || busy);

  useEffect(() => {
    if (open) requestAnimationFrame(() => primary.current?.focus());
  }, [open, state.status]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setDismissed(true);
      if (e.key === "Tab") {
        // Foco preso no aviso enquanto ele estiver aberto.
        const items = [...document.querySelectorAll<HTMLElement>(".update-dialog button:not(:disabled)")];
        if (!items.length) return e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  if (!open || !desktop) return null;
  const version = "version" in state && state.version ? `v${state.version}` : "";
  const install = () => void desktop.installUpdate().then(setState);

  return (
    <div className="modal">
      <div className="modal__overlay" aria-hidden onClick={() => !busy && setDismissed(true)} />
      <div className="modal__panel surface update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-text">
        <div className="update-dialog__icon" aria-hidden>
          {state.status === "error" ? <TriangleAlert size={20} /> : <Download size={20} />}
        </div>
        <h2 id="update-title" className="heading-card">
          {state.status === "error" ? "A atualização não terminou" : `Versão nova disponível ${version}`}
        </h2>
        <p id="update-text" className="hint update-dialog__text">
          {state.status === "available" && "Atualizar agora baixa a versão nova, fecha o app por alguns segundos e abre de novo. As conversas e a conexão continuam."}
          {state.status === "downloading" && `Baixando a atualização… ${state.percent}%`}
          {state.status === "installing" && "Instalando. O app fecha e abre de novo sozinho."}
          {state.status === "error" && `Não foi possível baixar ou instalar. Verifique a internet e tente de novo. (${state.message})`}
        </p>
        {state.status === "downloading" && (
          <div className="progress" role="progressbar" aria-label="Download da atualização" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}>
            <div className="progress__bar" style={{ transform: `scaleX(${state.percent / 100})` }} />
          </div>
        )}
        <div className="cluster update-dialog__actions">
          <button className="button button--secondary" onClick={() => setDismissed(true)} disabled={busy}>
            Depois
          </button>
          <button ref={primary} className="button button--primary" onClick={install} disabled={busy} aria-busy={busy || undefined}>
            {busy ? <LoaderCircle className="spin" size={16} aria-hidden /> : state.status === "error" ? <RefreshCw size={16} aria-hidden /> : <Download size={16} aria-hidden />}
            {state.status === "error" ? "Tentar de novo" : busy ? "Atualizando…" : "Atualizar agora"}
          </button>
        </div>
      </div>
    </div>
  );
}
