import { Bell, Download, Zap, KeyRound, LoaderCircle, Plus, RefreshCw, Settings2, Smartphone, Tags, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type AiStatus, type AppState, type Label, type Prefs, type QuickReply } from "./api.ts";
import { desktop, type ReleaseInfo, type UpdateState } from "./desktop.ts";
import { publishAi, useAiStatus } from "./ai-state.ts";
import { AiModels } from "./ai-models.tsx";

type Props = {
  open: boolean;
  /** Aba ao abrir (ex.: "ia" pelo botão de IA da conversa). */
  initialTab?: Tab;
  state: AppState;
  onClose: () => void;
  onSaved: (state: AppState, message: string) => void;
  notify: (kind: "error" | "success", text: string) => void;
};

export type Tab = "geral" | "notificacoes" | "ia" | "etiquetas" | "respostas" | "conta";
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "geral", label: "Geral", icon: <Settings2 size={16} aria-hidden /> },
  { id: "notificacoes", label: "Notificações", icon: <Bell size={16} aria-hidden /> },
  { id: "ia", label: "IA", icon: <KeyRound size={16} aria-hidden /> },
  { id: "etiquetas", label: "Etiquetas", icon: <Tags size={16} aria-hidden /> },
  { id: "respostas", label: "Respostas rápidas", icon: <Zap size={16} aria-hidden /> },
  { id: "conta", label: "Conta e dados", icon: <Smartphone size={16} aria-hidden /> },
];

const sameLabels = (a: Label[], b: Label[]) =>
  a.length === b.length && a.every((l, i) => l.name === b[i].name && l.description === b[i].description);
const sameQuick = (a: QuickReply[], b: QuickReply[]) =>
  a.length === b.length && a.every((q, i) => q.shortcut === b[i].shortcut && q.text === b[i].text);
const samePrefs = (a: Prefs, b: Prefs) => (Object.keys(a) as (keyof Prefs)[]).every((k) => a[k] === b[k]);

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]';

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`check${disabled ? " check--disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="check__text">
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
    </label>
  );
}

type AiPanelProps = {
  instructions: string;
  setInstructions: (v: string) => void;
  dsKey: string;
  setDsKey: (v: string) => void;
  removeDsKey: boolean;
  setRemoveDsKey: (v: boolean) => void;
};

function AiPanel({ instructions, setInstructions, dsKey, setDsKey, removeDsKey, setRemoveDsKey }: AiPanelProps) {
  const live = useAiStatus();
  const [local, setLocal] = useState<AiStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  // A resposta da ação vale até o próximo evento ao vivo; depois o evento vence.
  const ai = local ?? live;
  useEffect(() => setLocal(null), [live]);
  useEffect(() => {
    if (local) publishAi(local);
  }, [local]);
  if (!ai) return <p className="hint">Carregando…</p>;
  const choose = async (provider: AiStatus["provider"]) => {
    if (provider === ai.provider || switching) return;
    setSwitching(true);
    try {
      setLocal(await api.setAiProvider(provider));
    } finally {
      setSwitching(false);
    }
  };
  return (
    <div className="stack">
      <div className="segmented" role="radiogroup" aria-label="Onde a IA roda">
        {(
          [
            ["deepseek", "DeepSeek (nuvem)"],
            ["local", "Local (offline)"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={ai.provider === id} className="segmented__item" disabled={switching} onClick={() => void choose(id)}>
            {label}
          </button>
        ))}
      </div>
      {ai.provider === "deepseek" ? (
        <>
          {ai.deepseek.fromEnv ? (
            <p className="hint">A chave da DeepSeek está definida no arquivo .env.local deste computador.</p>
          ) : (
            <label className="field">
              <span className="field__label">Chave de API da DeepSeek</span>
              <input
                type="password"
                autoComplete="off"
                placeholder={ai.deepseek.configured ? "Chave salva. Cole outra para trocar." : "Cole a chave (sk-…)"}
                value={dsKey}
                onChange={(e) => {
                  setDsKey(e.target.value);
                  setRemoveDsKey(false);
                }}
                aria-describedby="ds-key-help"
              />
              <span id="ds-key-help" className="hint">
                {ai.deepseek.configured
                  ? "A chave fica salva só neste computador e nunca volta para a tela."
                  : "Crie a chave em platform.deepseek.com › API keys e salve aqui."}
              </span>
            </label>
          )}
          {ai.deepseek.configured && !ai.deepseek.fromEnv && <Toggle checked={removeDsKey} onChange={setRemoveDsKey} label="Remover a chave salva" />}
          <p className="hint">Rascunho e resumo em segundos. A DeepSeek recebe o nome do contato e o texto das últimas 40 mensagens da conversa.</p>
        </>
      ) : (
        <AiModels ai={ai} onChange={setLocal} />
      )}
      <label className="field">
        <span className="field__label">Como a IA deve escrever</span>
        <textarea className="notes__note" rows={4} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <span className="hint">Tom, regras e o que nunca prometer. Vale para os rascunhos de resposta.</span>
      </label>
    </div>
  );
}

function UpdatePanel() {
  const bridge = desktop();
  const [info, setInfo] = useState<{ version: string; packaged: boolean } | null>(null);
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  useEffect(() => {
    if (!bridge) return;
    void bridge.appInfo().then(setInfo);
    void bridge.getUpdate().then(setState);
    return bridge.onUpdate(setState);
  }, [bridge]);
  const [versions, setVersions] = useState<ReleaseInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const loadVersions = () => {
    if (!bridge) return;
    setListError(null);
    bridge
      .listVersions()
      .then((list) => {
        setVersions(list);
        setChosen((c) => c ?? list.find((v) => !v.current)?.version ?? null);
      })
      .catch((e: Error) => setListError(`Não foi possível listar as versões. Confira a internet. (${e.message})`));
  };
  if (!bridge) return <p className="hint">Atualização automática disponível no app instalado.</p>;
  const busy = state.status === "downloading" || state.status === "installing";
  const current = info?.version;
  const newer = (v: string) => !!current && v.localeCompare(current, undefined, { numeric: true }) > 0;
  const checking = state.status === "checking";
  const message =
    state.status === "latest"
      ? "Você está na versão mais recente."
      : state.status === "available"
        ? `Versão nova disponível: v${state.version}.`
        : state.status === "downloading"
          ? `Baixando v${state.version}… ${state.percent}%`
          : state.status === "installing"
            ? "Instalando a versão nova…"
            : state.status === "error"
              ? `Não foi possível verificar agora. Confira a internet. (${state.message})`
              : "As versões novas aparecem sozinhas quando você abre o app.";
  return (
    <div className="stack">
      <p className="hint">Versão instalada: {info ? `v${info.version}` : "…"}</p>
      <p className="hint" role="status">{message}</p>
      <div className="cluster">
        <button className="button button--secondary" onClick={() => void bridge.checkUpdate().then(setState)} disabled={checking || state.status === "downloading" || state.status === "installing"} aria-busy={checking || undefined}>
          {checking ? <LoaderCircle className="spin" size={16} aria-hidden /> : <RefreshCw size={16} aria-hidden />}
          Verificar atualização
        </button>
        {state.status === "available" && (
          <button className="button button--primary" onClick={() => void bridge.installUpdate().then(setState)}>
            Atualizar agora
          </button>
        )}
        <button className="button button--ghost" onClick={loadVersions} disabled={busy}>
          Ver todas as versões
        </button>
      </div>
      {listError && <p className="hint hint--warning">{listError}</p>}
      {versions && (
        <div className="stack">
          <ul className="versions" role="radiogroup" aria-label="Versões publicadas">
            {versions.map((v) => (
              <li key={v.version}>
                <label className="version">
                  <input type="radio" name="version" value={v.version} checked={chosen === v.version} disabled={v.current} onChange={() => setChosen(v.version)} />
                  <span className="version__info">
                    <strong>
                      v{v.version} {v.current ? "· instalada" : newer(v.version) ? "· mais nova" : "· anterior"}
                    </strong>
                    <span className="hint">Publicada em {new Date(v.date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
                    {v.notes && <span className="hint version__notes">{v.notes}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="cluster">
            <button className="button button--primary" disabled={!chosen || busy} aria-busy={busy || undefined} onClick={() => chosen && void bridge.installVersion(chosen).then(setState)}>
              {busy && <LoaderCircle className="spin" size={16} aria-hidden />}
              {chosen && !newer(chosen) ? `Voltar para v${chosen}` : chosen ? `Instalar v${chosen}` : "Escolha uma versão"}
            </button>
          </div>
          {chosen && !newer(chosen) && <p className="hint">Voltar para uma versão anterior mantém conversas e configurações.</p>}
        </div>
      )}
    </div>
  );
}

export function SettingsDrawer({ open, initialTab, state, onClose, onSaved, notify }: Props) {
  const [tab, setTab] = useState<Tab>("geral");
  const [labels, setLabels] = useState<Label[]>(state.labels);
  const [aiText, setAiText] = useState("");
  const [savedAiText, setSavedAiText] = useState("");
  const [quick, setQuick] = useState<QuickReply[]>([]);
  const [savedQuick, setSavedQuick] = useState<QuickReply[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(state.prefs);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [auto, setAuto] = useState(state.jev.autoClassify);
  const [dsKey, setDsKey] = useState("");
  const [removeDsKey, setRemoveDsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"discard" | "logout" | "reset" | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const isDesktop = !!desktop();

  // Abre sempre a partir do estado salvo.
  useEffect(() => {
    if (!open) return;
    setTab(initialTab ?? "geral");
    setLabels(state.labels);
    setPrefs(state.prefs);
    api.ai().then((a) => {
      setAiText(a.instructions);
      setSavedAiText(a.instructions);
    }).catch(() => undefined);
    api.quickReplies().then((q) => {
      setQuick(q);
      setSavedQuick(q);
    }).catch(() => undefined);
    setKey("");
    setRemoveKey(false);
    setDsKey("");
    setRemoveDsKey(false);
    setAuto(state.jev.autoClassify);
    setError(null);
    setConfirm(null);
    returnFocus.current = document.activeElement;
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    return () => (returnFocus.current as HTMLElement | null)?.focus?.();
  }, [open]);

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const quietOn = !!(prefs.quietStart && prefs.quietEnd);
  const dirty =
    !sameLabels(labels, state.labels) || aiText !== savedAiText || !sameQuick(quick, savedQuick) || !samePrefs(prefs, state.prefs) || key.trim() !== "" || removeKey || dsKey.trim() !== "" || removeDsKey || auto !== state.jev.autoClassify;

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
    if (quietOn && prefs.quietStart === prefs.quietEnd) {
      setTab("notificacoes");
      setError("O horário de silêncio precisa ter início e fim diferentes.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let next = state;
      if (!sameLabels(labels, state.labels)) {
        const cleaned = labels.map((l) => ({ name: l.name.trim(), description: l.description.trim() }));
        next = { ...next, labels: await api.saveLabels(cleaned) };
      }
      if (aiText !== savedAiText) await api.setAiInstructions(aiText.trim() || null);
      if (!sameQuick(quick, savedQuick)) {
        await api.saveQuickReplies(quick.map((q) => ({ shortcut: q.shortcut.trim().replace(/^\//, "").toLowerCase(), text: q.text.trim() })));
      }
      const settings: Parameters<typeof api.saveSettings>[0] = {};
      if (key.trim()) settings.jevApiKey = key.trim();
      else if (removeKey) settings.jevApiKey = null;
      if (dsKey.trim()) settings.deepseekApiKey = dsKey.trim();
      else if (removeDsKey) settings.deepseekApiKey = null;
      if (auto !== state.jev.autoClassify) settings.autoClassify = auto;
      if (!samePrefs(prefs, state.prefs)) settings.prefs = prefs;
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
  const desktopOnly = isDesktop ? undefined : "Disponível no app instalado.";

  return (
    <div className="drawer">
      <div className="drawer__overlay" onClick={requestClose} aria-hidden />
      <div className="drawer__panel drawer__panel--wide" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={panel}>
        <header className="drawer__header">
          <h2 id="settings-title" className="heading-detail">
            Configurações
          </h2>
          <button className="icon-button" aria-label="Fechar configurações" onClick={requestClose} disabled={saving}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Seções das configurações">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="settings-panel"
              className="settings-tabs__item"
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="drawer__body" id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {error && (
            <p className="alert alert--danger" role="alert">
              {error}
            </p>
          )}

          {tab === "geral" && (
            <>
              <section className="surface stack">
                <h3 className="eyebrow">Inicialização</h3>
                <Toggle
                  checked={prefs.startWithWindows}
                  onChange={(v) => setPref("startWithWindows", v)}
                  disabled={!isDesktop}
                  label="Abrir junto com o Windows"
                  hint={desktopOnly ?? "Assim as mensagens chegam e são classificadas mesmo antes de você abrir o app."}
                />
                <Toggle
                  checked={prefs.startMinimized}
                  onChange={(v) => setPref("startMinimized", v)}
                  disabled={!isDesktop || !prefs.startWithWindows}
                  label="Começar minimizado na bandeja"
                  hint="Ao ligar o computador, o app fica perto do relógio sem abrir a janela."
                />
              </section>
              <section className="surface stack">
                <h3 className="eyebrow">Atualização</h3>
                <UpdatePanel />
              </section>
            </>
          )}

          {tab === "notificacoes" && (
            <section className="surface stack">
              <h3 className="eyebrow">Notificações do Windows</h3>
              <Toggle
                checked={prefs.notifyEnabled}
                onChange={(v) => setPref("notifyEnabled", v)}
                disabled={!isDesktop}
                label="Avisar quando chegar mensagem"
                hint={desktopOnly ?? "Só quando o app não está na frente. Clicar no aviso abre a conversa."}
              />
              <Toggle checked={prefs.notifySound} onChange={(v) => setPref("notifySound", v)} disabled={!isDesktop || !prefs.notifyEnabled} label="Tocar som" />
              <Toggle
                checked={prefs.notifyPreview}
                onChange={(v) => setPref("notifyPreview", v)}
                disabled={!isDesktop || !prefs.notifyEnabled}
                label="Mostrar o texto da mensagem"
                hint="Desligado, o aviso mostra só o nome e “Nova mensagem”."
              />
              <Toggle
                checked={quietOn}
                onChange={(v) => setPrefs((p) => ({ ...p, quietStart: v ? "22:00" : null, quietEnd: v ? "07:00" : null }))}
                disabled={!isDesktop || !prefs.notifyEnabled}
                label="Horário de silêncio"
                hint="Nesse intervalo as mensagens chegam normalmente, sem aviso."
              />
              {quietOn && (
                <div className="cluster">
                  <label className="field field--time">
                    <span className="field__label">Das</span>
                    <input type="time" value={prefs.quietStart ?? ""} onChange={(e) => setPref("quietStart", e.target.value || null)} />
                  </label>
                  <label className="field field--time">
                    <span className="field__label">Até</span>
                    <input type="time" value={prefs.quietEnd ?? ""} onChange={(e) => setPref("quietEnd", e.target.value || null)} />
                  </label>
                </div>
              )}
            </section>
          )}

          {tab === "ia" && (
            <section className="surface stack">
              <h3 className="eyebrow">Jev</h3>
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
                <Toggle checked={removeKey} onChange={setRemoveKey} label="Remover a chave salva" />
              )}
              <Toggle
                checked={auto}
                onChange={setAuto}
                label="Classificar sozinho quando chegar mensagem nova"
                hint="Espera 15 s sem mensagens novas na conversa e chama o Jev uma vez."
              />
              <p className="hint">O Jev recebe o nome do contato e o texto das últimas 30 mensagens da conversa para sugerir a etiqueta.</p>
            </section>
          )}
          {tab === "ia" && (
            <section className="surface stack">
              <h3 className="eyebrow">Rascunho e resumo</h3>
              <AiPanel
                instructions={aiText}
                setInstructions={setAiText}
                dsKey={dsKey}
                setDsKey={setDsKey}
                removeDsKey={removeDsKey}
                setRemoveDsKey={setRemoveDsKey}
              />
            </section>
          )}

          {tab === "etiquetas" && (
            <section className="surface stack">
              <h3 className="eyebrow">Etiquetas</h3>
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
          )}

          {tab === "respostas" && (
            <section className="surface stack">
              <h3 className="eyebrow">Respostas rápidas</h3>
              <p className="hint">Na conversa, digite / e o atalho (ex.: /pix) ou use o botão de raio. {"{nome}"} vira o primeiro nome do contato.</p>
              <ul className="labels-editor">
                {quick.map((q, i) => (
                  <li key={i} className="labels-editor__row">
                    <label className="field">
                      <span className="sr-only">Atalho {i + 1}</span>
                      <input value={q.shortcut} maxLength={30} placeholder="atalho" onChange={(e) => setQuick((l) => l.map((x, j) => (j === i ? { ...x, shortcut: e.target.value } : x)))} />
                    </label>
                    <label className="field">
                      <span className="sr-only">Texto {i + 1}</span>
                      <textarea className="quick-editor__text" rows={2} value={q.text} placeholder="Texto da mensagem" onChange={(e) => setQuick((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                    </label>
                    <button className="icon-button" aria-label={`Remover resposta /${q.shortcut || i + 1}`} onClick={() => setQuick((l) => l.filter((_, j) => j !== i))}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <button className="button button--ghost button--compact" disabled={quick.length >= 100} onClick={() => setQuick((l) => [...l, { shortcut: "", text: "" }])}>
                <Plus size={16} aria-hidden /> Adicionar resposta rápida
              </button>
            </section>
          )}

          {tab === "conta" && (
            <section className="surface stack">
              <h3 className="eyebrow">Conta e dados</h3>
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
          )}
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
