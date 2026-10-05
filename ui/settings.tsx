import { Download, KeyRound, LoaderCircle, Plus, Smartphone, Tags, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AppState, type Label } from "./api.ts";

type Props = {
  open: boolean;
  state: AppState;
  onClose: () => void;
  onSaved: (state: AppState, message: string) => void;
  notify: (kind: "error" | "success", text: string) => void;
};

const sameLabels = (a: Label[], b: Label[]) =>
  a.length === b.length && a.every((l, i) => l.name === b[i].name && l.description === b[i].description);

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]';

export function SettingsDrawer({ open, state, onClose, onSaved, notify }: Props) {
  const [labels, setLabels] = useState<Label[]>(state.labels);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [auto, setAuto] = useState(state.jev.autoClassify);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"discard" | "logout" | "reset" | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  // Abre sempre a partir do estado salvo.
  useEffect(() => {
    if (!open) return;
    setLabels(state.labels);
    setKey("");
    setRemoveKey(false);
    setAuto(state.jev.autoClassify);
    setError(null);
    setConfirm(null);
    returnFocus.current = document.activeElement;
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    return () => (returnFocus.current as HTMLElement | null)?.focus?.();
  }, [open]);

  const dirty = !sameLabels(labels, state.labels) || key.trim() !== "" || removeKey || auto !== state.jev.autoClassify;

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirm("discard");
    else onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirm) setConfirm(null);
      else requestClose();
    }
    if (e.key === "Tab" && panel.current) {
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.current.contains(document.activeElement);
      if (!inside || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // No documento, e não no painel: o botão clicado pode sumir (ex.: "Continuar editando")
  // e levar o foco para o body; Esc e Tab precisam continuar funcionando.
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => keyHandler.current(e);
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);

  // Ao sair da confirmação, devolve o foco ao rodapé do painel.
  const previousConfirm = useRef(confirm);
  useEffect(() => {
    if (open && previousConfirm.current !== null && confirm === null) {
      panel.current?.querySelector<HTMLElement>(".drawer__footer button:not(:disabled)")?.focus();
    }
    previousConfirm.current = confirm;
  }, [confirm, open]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let next = state;
      if (!sameLabels(labels, state.labels)) {
        const cleaned = labels.map((l) => ({ name: l.name.trim(), description: l.description.trim() }));
        next = { ...next, labels: await api.saveLabels(cleaned) };
      }
      const settings: { jevApiKey?: string | null; autoClassify?: boolean } = {};
      if (key.trim()) settings.jevApiKey = key.trim();
      else if (removeKey) settings.jevApiKey = null;
      if (auto !== state.jev.autoClassify) settings.autoClassify = auto;
      if (Object.keys(settings).length) next = await api.saveSettings(settings);
      onSaved(next, "Configurações salvas.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const accountAction = async (kind: "logout" | "reset") => {
    setLoggingOut(true);
    try {
      const next = kind === "logout" ? await api.logout() : await api.reset(true);
      onSaved(next, kind === "logout" ? "WhatsApp desconectado. Leia o QR com o número que quer usar." : "Conversas apagadas. Leia o QR para trazer o histórico de novo.");
      onClose();
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setLoggingOut(false);
      setConfirm(null);
    }
  };

  if (!open) return null;
  const connected = state.connection.status === "conectado";

  return (
    <div className="drawer">
      <div className="drawer__overlay" onClick={requestClose} aria-hidden />
      <div className="drawer__panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={panel}>
        <header className="drawer__header">
          <h2 id="settings-title" className="heading-detail">
            Configurações
          </h2>
          <button className="icon-button" aria-label="Fechar configurações" onClick={requestClose} disabled={saving}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="drawer__body">
          {error && (
            <p className="alert alert--danger" role="alert">
              {error}
            </p>
          )}

          <section className="surface stack">
            <h3 className="eyebrow">
              <KeyRound size={14} aria-hidden /> Jev
            </h3>
            {state.jev.fromEnv ? (
              <p className="hint">A chave do Jev está definida no arquivo .env.local deste computador.</p>
            ) : (
              <label className="field">
                <span className="field__label">Chave de API do Jev</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={state.jev.configured ? "Chave salva. Cole outra para trocar." : "Cole a chave do Jev"}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setRemoveKey(false);
                  }}
                  aria-describedby="jev-key-help"
                />
                <span id="jev-key-help" className="hint">
                  {state.jev.configured
                    ? "A chave fica salva só neste computador e nunca volta para a tela."
                    : "Sem chave, a classificação automática fica desligada."}
                </span>
              </label>
            )}
            {state.jev.configured && !state.jev.fromEnv && (
              <label className="check">
                <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />
                <span>Remover a chave salva</span>
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span>Classificar sozinho quando chegar mensagem nova (aguarda 15 s de silêncio)</span>
            </label>
            <p className="hint">
              O Jev recebe o nome do contato e o texto das últimas 30 mensagens da conversa para sugerir a etiqueta.
            </p>
          </section>

          <section className="surface stack">
            <h3 className="eyebrow">
              <Tags size={14} aria-hidden /> Etiquetas
            </h3>
            <p className="hint">A descrição orienta o Jev. Escreva o que entra em cada etiqueta.</p>
            <ul className="labels-editor">
              {labels.map((l, i) => (
                <li key={i} className="labels-editor__row">
                  <label className="field">
                    <span className="sr-only">Nome da etiqueta {i + 1}</span>
                    <input
                      value={l.name}
                      maxLength={40}
                      placeholder="Nome"
                      onChange={(e) => setLabels((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                  </label>
                  <label className="field">
                    <span className="sr-only">Descrição da etiqueta {i + 1}</span>
                    <input
                      value={l.description}
                      maxLength={300}
                      placeholder="O que entra nesta etiqueta"
                      onChange={(e) => setLabels((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                    />
                  </label>
                  <button
                    className="icon-button"
                    aria-label={`Remover etiqueta ${l.name || i + 1}`}
                    disabled={labels.length <= 2}
                    onClick={() => setLabels((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="button button--ghost button--compact"
              disabled={labels.length >= 30}
              onClick={() => setLabels((ls) => [...ls, { name: "", description: "" }])}
            >
              <Plus size={16} aria-hidden /> Adicionar etiqueta
            </button>
          </section>

          <section className="surface stack">
            <h3 className="eyebrow">
              <Smartphone size={14} aria-hidden /> Conta e dados
            </h3>
            <p className="hint">
              {connected && state.connection.me
                ? `Conectado como +${state.connection.me.split("@")[0]}.`
                : "Nenhum WhatsApp conectado agora."}{" "}
              Cada número tem a sua caixa de entrada: ao conectar outro número, as conversas do anterior saem deste computador.
            </p>
            {confirm === "logout" || confirm === "reset" ? (
              <div className="alert alert--danger stack" role="alert">
                <p>
                  {confirm === "logout"
                    ? "Desconectar este número? Depois leia o QR com o número que quer usar. Se for outro número, as conversas atuais são apagadas deste computador."
                    : "Apagar todas as conversas deste computador e ler o QR de novo? O histórico do número conectado volta pelo WhatsApp. Etiquetas e configurações ficam."}
                </p>
                <div className="cluster">
                  <button className="button button--secondary" onClick={() => setConfirm(null)} disabled={loggingOut}>
                    Cancelar
                  </button>
                  <button className="button button--danger" onClick={() => accountAction(confirm)} disabled={loggingOut} aria-busy={loggingOut || undefined}>
                    {loggingOut && <LoaderCircle className="spin" size={16} aria-hidden />}
                    {confirm === "logout" ? "Desconectar" : "Apagar e reconectar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="cluster">
                <button className="button button--secondary" disabled={!connected} onClick={() => setConfirm("logout")}>
                  Trocar de número
                </button>
                <button className="button button--secondary" onClick={() => setConfirm("reset")}>
                  <Trash2 size={16} aria-hidden /> Apagar conversas e reconectar
                </button>
                <a className="button button--ghost" href="/api/backup" download>
                  <Download size={16} aria-hidden /> Baixar backup
                </a>
              </div>
            )}
          </section>
        </div>

        <footer className="drawer__footer">
          {confirm === "discard" ? (
            <div className="drawer__confirm" role="alertdialog" aria-label="Descartar alterações?">
              <p className="drawer__confirm-text">Descartar alterações?</p>
              <div className="cluster">
                <button className="button button--secondary" onClick={() => setConfirm(null)} autoFocus>
                  Continuar editando
                </button>
                <button className="button button--danger" onClick={onClose}>
                  Descartar
                </button>
              </div>
            </div>
          ) : (
            <div className="cluster drawer__actions">
              <button className="button button--secondary" onClick={requestClose} disabled={saving}>
                Cancelar
              </button>
              <button className="button button--primary" onClick={save} disabled={!dirty || saving} aria-busy={saving || undefined}>
                {saving && <LoaderCircle className="spin" size={16} aria-hidden />}
                Salvar alterações
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
