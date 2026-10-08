import { Download, History, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ReleaseInfo, UpdateState } from "./desktop.ts";
import { Button } from "./ds/index.ts";

const SEEN_KEY = "update-toast-seen";
const IGNORE = /^(merge |release:|chore|docs|test|ci|build|style)/i;

/** Notas da release (mensagens de commit) em frases simples: sem prefixo técnico nem merges. */
export function releaseChanges(notes: string): string[] {
  const out: string[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    let line = raw.replace(/^[-*•]\s*/, "").trim();
    if (!line || IGNORE.test(line)) continue;
    line = line.replace(/^\w+(\([^)]*\))?!?:\s*/, "").replace(/\s*\(#\d+\)$/, "").trim();
    if (!line) continue;
    line = line[0].toUpperCase() + line.slice(1);
    if (!/[.!?]$/.test(line)) line += ".";
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const writeSeen = (version: string) => {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // sem storage o aviso só volta na próxima abertura
  }
};

/**
 * Aviso de versão nova em toast, só no app desktop. O app consulta a cada 2 minutos;
 * cada versão nova aparece uma única vez, com o que mudou em linguagem simples.
 */
export function UpdateDialog({ onShowVersions }: { onShowVersions: () => void }) {
  const desktop = window.desktop;
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [shown, setShown] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [changes, setChanges] = useState<string[] | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void desktop.getUpdate().then(setState);
    return desktop.onUpdate(setState);
  }, [desktop]);

  // Versão nova ainda não avisada: marca como vista e busca o que mudou desde a instalada.
  const available = state.status === "available" ? state.version : null;
  useEffect(() => {
    if (!desktop || !available || readSeen() === available) return;
    writeSeen(available);
    setShown(available);
    setClosed(false);
    setChanges(null);
    desktop
      .listVersions()
      .then((list: ReleaseInfo[]) => {
        const i = list.findIndex((v) => v.current);
        const newer = i >= 0 ? list.slice(0, i) : list.filter((v) => v.version === available);
        setChanges(newer.flatMap((v) => releaseChanges(v.notes)));
      })
      .catch(() => setChanges([]));
  }, [desktop, available]);

  const busy = state.status === "downloading" || state.status === "installing";
  const failed = state.status === "error" && !!state.version;
  const open = !!desktop && (busy || failed || (!!shown && state.status === "available" && !closed));
  if (!open || !desktop) return null;

  const version = "version" in state && state.version ? `v${state.version}` : "";
  const install = () => void desktop.installUpdate().then(setState);
  const close = () => {
    setClosed(true);
    if (failed) setState({ status: "idle" });
  };

  return (
    <div className="update-toast surface" role="status" aria-live="polite" aria-labelledby="update-title">
      <div className="update-toast__head">
        <span className="update-toast__icon" aria-hidden>
          {failed ? <TriangleAlert size={16} /> : <Download size={16} />}
        </span>
        <strong id="update-title" className="update-toast__title">
          {failed ? "A atualização não terminou" : `Versão nova ${version}`}
        </strong>
        {!busy && (
          <button type="button" className="update-toast__close" aria-label="Fechar aviso" onClick={close}>
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {state.status === "available" && (
        <div className="update-toast__body">
          <p className="hint">O que mudou:</p>
          {changes === null ? (
            <p className="hint">Carregando…</p>
          ) : changes.length ? (
            <ul className="update-toast__changes">
              {changes.slice(0, 6).map((c) => (
                <li key={c}>{c}</li>
              ))}
              {changes.length > 6 && <li className="hint">E mais {changes.length - 6} melhorias.</li>}
            </ul>
          ) : (
            <p className="hint">Melhorias e correções.</p>
          )}
        </div>
      )}
      {state.status === "downloading" && (
        <>
          <p className="hint">Baixando a atualização… {state.percent}%</p>
          <div className="progress" role="progressbar" aria-label="Download da atualização" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}>
            <div className="progress__bar" style={{ transform: `scaleX(${state.percent / 100})` }} />
          </div>
        </>
      )}
      {state.status === "installing" && <p className="hint">Instalando. O app fecha e abre de novo sozinho em até 1 minuto.</p>}
      {failed && state.status === "error" && <p className="hint">Verifique a internet e tente de novo. ({state.message})</p>}

      {!busy && (
        <div className="cluster update-toast__actions">
          <Button variant="ghost" icon={<History size={16} aria-hidden />} onClick={() => { setClosed(true); onShowVersions(); }}>
            Ver versões
          </Button>
          <Button variant="primary" onClick={install} icon={failed ? <RefreshCw size={16} aria-hidden /> : <Download size={16} aria-hidden />}>
            {failed ? "Tentar de novo" : "Atualizar agora"}
          </Button>
        </div>
      )}
    </div>
  );
}
