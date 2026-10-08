import { Bell, Briefcase, ChartColumn, Download, Monitor, Moon, Sun, Zap, KeyRound, Plus, RefreshCw, Settings2, Smartphone, Tags, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type AiStatus, type AppState, type Classifier, type Label, type Prefs, type QuickReply, type Theme } from "./api.ts";
import { desktop, useAccount, type ReleaseInfo, type UpdateState } from "./desktop.ts";
import { publishAi, useAiStatus } from "./ai-state.ts";
import { ClaudeOptionsPanel, DeepSeekOptionsPanel, JevContextField } from "./ai-options.tsx";
import { applyTheme } from "./theme.ts";
import { Button, buttonClassName, Checkbox, Field, Input, Radio, SegmentedControl, Textarea } from "./ds/index.ts";
import { AiUsagePanel } from "./ai-usage.tsx";
import { releaseChanges } from "./update.tsx";

type Props = {
  open: boolean;
  /** Aba ao abrir (ex.: "ia" pelo botão de IA da conversa). */
  initialTab?: Tab;
  state: AppState;
  onClose: () => void;
  onSaved: (state: AppState, message: string) => void;
  notify: (kind: "error" | "success", text: string) => void;
};

export type Tab = "geral" | "notificacoes" | "ia" | "gastos" | "etiquetas" | "respostas" | "conta";
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "geral", label: "Geral", icon: <Settings2 size={16} aria-hidden /> },
  { id: "notificacoes", label: "Notificações", icon: <Bell size={16} aria-hidden /> },
  { id: "ia", label: "IA", icon: <KeyRound size={16} aria-hidden /> },
  { id: "gastos", label: "Gastos com IA", icon: <ChartColumn size={16} aria-hidden /> },
  { id: "etiquetas", label: "Etiquetas", icon: <Tags size={16} aria-hidden /> },
  { id: "respostas", label: "Respostas rápidas", icon: <Zap size={16} aria-hidden /> },
  { id: "conta", label: "Conta e dados", icon: <Smartphone size={16} aria-hidden /> },
];

const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: "system", label: "Sistema", icon: <Monitor size={16} aria-hidden /> },
  { id: "light", label: "Claro", icon: <Sun size={16} aria-hidden /> },
  { id: "dark", label: "Escuro", icon: <Moon size={16} aria-hidden /> },
];

const sameLabels = (a: Label[], b: Label[]) =>
  a.length === b.length && a.every((l, i) => l.name === b[i].name && l.description === b[i].description);
const sameQuick = (a: QuickReply[], b: QuickReply[]) =>
  a.length === b.length && a.every((q, i) => q.shortcut === b[i].shortcut && q.text === b[i].text);
const samePrefs = (a: Prefs, b: Prefs) => (Object.keys(a) as (keyof Prefs)[]).every((k) => a[k] === b[k]);

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]';

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <Checkbox checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} label={label} description={hint || undefined} />
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

/** IA e modelo do resumo (conversa e áudio), separados do rascunho. */
function SummaryModelPanel() {
  const live = useAiStatus();
  const [saving, setSaving] = useState(false);
  if (!live) return null;
  const s = live.summary;
  const save = async (choice: Partial<AiStatus["summary"]>) => {
    setSaving(true);
    try {
      publishAi(await api.setSummaryModel(choice));
    } finally {
      setSaving(false);
    }
  };
  const providers = [
    ["same", "Igual ao rascunho"],
    ["deepseek", "DeepSeek"],
    ["claude", "Claude"],
  ] as const;
  return (
    <div className="stack">
      <SegmentedControl
        aria-label="IA do resumo"
        options={providers.map(([id, label]) => ({ value: id, label, disabled: saving }))}
        value={s.provider}
        onChange={(id) => s.provider !== id && void save({ provider: id })}
      />
      {s.provider === "deepseek" && (
        <SegmentedControl
          aria-label="Modelo da DeepSeek para resumo"
          options={live.deepseek.models.map((m) => ({ value: m.id, label: m.name, disabled: saving }))}
          value={s.deepseekModel}
          onChange={(id) => void save({ deepseekModel: id })}
        />
      )}
      {s.provider === "claude" && (
        <SegmentedControl
          aria-label="Modelo do Claude para resumo"
          options={live.claude.models.map((m) => ({ value: m.id, label: m.name, disabled: saving }))}
          value={s.claudeModel}
          onChange={(id) => void save({ claudeModel: id })}
        />
      )}
      <p className="hint">
        {s.provider === "claude"
          ? "O Claude pelo plano leva cerca de 1 minuto por resumo: o resumo automático de áudio fica lento."
          : "Recomendado: DeepSeek Flash, mais barato e rápido. Vale para o resumo da conversa e o dos áudios; salvo na hora."}
      </p>
    </div>
  );
}

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
  const chooseModel = async (model: AiStatus["deepseek"]["model"]) => {
    if (model === ai.deepseek.model || switching) return;
    setSwitching(true);
    try {
      setLocal(await api.setDeepseekModel(model));
    } finally {
      setSwitching(false);
    }
  };
  const chooseClaudeModel = async (model: AiStatus["claude"]["model"]) => {
    if (model === ai.claude.model || switching) return;
    setSwitching(true);
    try {
      setLocal(await api.setClaudeModel(model));
    } finally {
      setSwitching(false);
    }
  };
  const dsModel = ai.deepseek.models.find((m) => m.id === ai.deepseek.model);
  const clModel = ai.claude.models.find((m) => m.id === ai.claude.model);
  return (
    <div className="stack">
      <SegmentedControl
        aria-label="Onde a IA roda"
        options={(
          [
            ["deepseek", "DeepSeek (nuvem)"],
            ["claude", "Claude (plano)"],
          ] as const
        ).map(([id, label]) => ({ value: id, label, disabled: switching }))}
        value={ai.provider}
        onChange={(id) => void choose(id)}
      />
      {ai.provider === "deepseek" ? (
        <>
          {ai.deepseek.fromEnv ? (
            <p className="hint">A chave da DeepSeek está definida no arquivo .env.local deste computador.</p>
          ) : (
            <Field
              label="Chave de API da DeepSeek"
              hint={
                ai.deepseek.configured
                  ? "A chave fica salva só neste computador e nunca volta para a tela."
                  : "Crie a chave em platform.deepseek.com › API keys e salve aqui."
              }
            >
              <Input
                type="password"
                autoComplete="off"
                placeholder={ai.deepseek.configured ? "Chave salva. Cole outra para trocar." : "Cole a chave (sk-…)"}
                value={dsKey}
                onChange={(e) => {
                  setDsKey(e.target.value);
                  setRemoveDsKey(false);
                }}
              />
            </Field>
          )}
          {ai.deepseek.configured && !ai.deepseek.fromEnv && <Toggle checked={removeDsKey} onChange={setRemoveDsKey} label="Remover a chave salva" />}
          <Field label="Modelo" hint={dsModel?.hint}>
            <SegmentedControl
              aria-label="Modelo da DeepSeek"
              options={ai.deepseek.models.map((m) => ({ value: m.id, label: m.name, disabled: switching }))}
              value={ai.deepseek.model}
              onChange={(id) => void chooseModel(id)}
            />
          </Field>
          <p className="hint">
            A DeepSeek recebe o nome do contato e o texto das últimas {ai.deepseek.options.contextMessages} mensagens da conversa. Modelo e opções valem para o rascunho e
            a classificação pela DeepSeek (e para o resumo, se ele seguir o rascunho) e são salvos na hora.
          </p>
          <details className="ai-advanced" open={JSON.stringify(ai.deepseek.options) !== JSON.stringify(ai.deepseek.defaults) || undefined}>
            <summary>Thinking, contexto e limites</summary>
            <DeepSeekOptionsPanel ai={ai} onChange={setLocal} />
          </details>
        </>
      ) : ai.provider === "claude" ? (
        <>
          <Field label="Modelo" hint={clModel?.hint}>
            <SegmentedControl
              aria-label="Modelo do Claude"
              options={ai.claude.models.map((m) => ({ value: m.id, label: m.name, disabled: switching }))}
              value={ai.claude.model}
              onChange={(id) => void chooseClaudeModel(id)}
            />
          </Field>
          <p className="hint">
            {ai.claude.configured
              ? "Usa o Claude Code deste PC, logado na sua conta: sem chave de API, consome o limite do seu plano e leva cerca de 1 minuto por resposta. Herda suas instruções e MCPs; só a leitura do Dataverse fica liberada."
              : "Claude Code não encontrado neste PC. Instale e faça login rodando claude no terminal."}
          </p>
          <p className="hint">Instruções só de atendimento: crie um CLAUDE.md em {ai.claude.folder}. O rascunho usa o Claude (e o resumo, se seguir o rascunho); a classificação continua no Jev ou na DeepSeek.</p>
          <details className="ai-advanced" open={JSON.stringify(ai.claude.options) !== JSON.stringify(ai.claude.defaults) || undefined}>
            <summary>Esforço, contexto e limites</summary>
            <ClaudeOptionsPanel ai={ai} onChange={setLocal} />
          </details>
        </>
      ) : null}
      <Field label="Como a IA deve escrever" hint="Tom, regras e o que nunca prometer. Vale para os rascunhos de resposta.">
        <Textarea rows={4} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
    </div>
  );
}

/** Contas do WhatsApp neste app: cada uma é separada (conversas, número e configurações). */
function AccountsPanel() {
  const bridge = desktop();
  const account = useAccount();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (account) setName(account.name);
  }, [account?.name]);
  if (!bridge || !account) return null;
  const changed = name.trim() !== "" && name.trim() !== account.name;
  const rename = () => {
    setBusy(true);
    void bridge.renameAccount(name).finally(() => setBusy(false));
  };
  return (
    <section className="surface stack">
      <h3 className="eyebrow">Contas do WhatsApp</h3>
      <p className="hint">
        {account.count > 1
          ? `Esta é a conta "${account.name}", uma de ${account.count} neste app. Cada conta tem conversas, número e configurações próprios; troque de conta pelo trilho à esquerda ou com Ctrl+1 a Ctrl+${Math.min(account.count, 9)}.`
          : "Use mais de um número ao mesmo tempo, como um pessoal e um business: cada conta fica separada, com conversas e configurações próprias."}
      </p>
      <form
        className="cluster"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) rename();
        }}
      >
        <Field label="Nome desta conta">
          <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button variant="secondary" type="submit" disabled={!changed} loading={busy}>
          Renomear
        </Button>
      </form>
      <div className="cluster">
        <Button variant="secondary" type="button" icon={<Plus size={16} aria-hidden />} onClick={() => void bridge.addAccount()} disabled={account.count >= account.max}>
          Adicionar outra conta
        </Button>
      </div>
      {account.count > 1 && account.removable && <p className="hint">Para remover esta conta, clique com o botão direito nela no trilho à esquerda.</p>}
    </section>
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
              : "O app verifica versões novas a cada 2 minutos e avisa uma vez.";
  return (
    <div className="stack">
      <p className="hint">Versão instalada: {info ? `v${info.version}` : "…"}</p>
      <p className="hint" role="status">{message}</p>
      <div className="cluster">
        <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} loading={checking} onClick={() => void bridge.checkUpdate().then(setState)} disabled={state.status === "downloading" || state.status === "installing"}>
          Verificar atualização
        </Button>
        {state.status === "available" && (
          <Button variant="primary" onClick={() => void bridge.installUpdate().then(setState)}>
            Atualizar agora
          </Button>
        )}
        <Button variant="ghost" onClick={loadVersions} disabled={busy}>
          Ver todas as versões
        </Button>
      </div>
      {listError && <p className="hint hint--warning">{listError}</p>}
      {versions && (
        <div className="stack">
          <ul className="versions" role="radiogroup" aria-label="Versões publicadas">
            {versions.map((v) => (
              <li key={v.version}>
                <Radio
                  name="version"
                  value={v.version}
                  checked={chosen === v.version}
                  disabled={v.current}
                  onChange={() => setChosen(v.version)}
                  label={<strong>v{v.version} {v.current ? "· instalada" : newer(v.version) ? "· mais nova" : "· anterior"}</strong>}
                  description={
                    <>
                      Publicada em {new Date(v.date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      {releaseChanges(v.notes).length > 0 && <span className="version__notes">{releaseChanges(v.notes).map((c) => `• ${c}`).join("\n")}</span>}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
          <div className="cluster">
            <Button variant="primary" disabled={!chosen} loading={busy} onClick={() => chosen && void bridge.installVersion(chosen).then(setState)}>
              {chosen && !newer(chosen) ? `Voltar para v${chosen}` : chosen ? `Instalar v${chosen}` : "Escolha uma versão"}
            </Button>
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
  const [importingQuick, setImportingQuick] = useState(false);
  const [savedQuick, setSavedQuick] = useState<QuickReply[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(state.prefs);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [auto, setAuto] = useState(state.jev.autoClassify);
  const [classifier, setClassifier] = useState<Classifier>(state.classifier.provider);
  const [dsKey, setDsKey] = useState("");
  const [removeDsKey, setRemoveDsKey] = useState(false);
  const [groqKey, setGroqKey] = useState("");
  const [removeGroqKey, setRemoveGroqKey] = useState(false);
  const [autoTranscribe, setAutoTranscribe] = useState(state.groq.autoTranscribe);
  const [autoSummarize, setAutoSummarize] = useState(state.groq.autoSummarize);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"discard" | "logout" | "reset" | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const isDesktop = !!desktop();
  const liveAi = useAiStatus();

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
    setGroqKey("");
    setRemoveGroqKey(false);
    setAutoTranscribe(state.groq.autoTranscribe);
    setAutoSummarize(state.groq.autoSummarize);
    setAuto(state.jev.autoClassify);
    setClassifier(state.classifier.provider);
    setError(null);
    setConfirm(null);
    returnFocus.current = document.activeElement;
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    return () => (returnFocus.current as HTMLElement | null)?.focus?.();
  }, [open]);

  // Aparência muda na hora para conferir; fechar sem salvar volta ao tema salvo.
  useEffect(() => {
    applyTheme(open ? prefs.theme : state.prefs.theme);
  }, [open, prefs.theme, state.prefs.theme]);

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const quietOn = !!(prefs.quietStart && prefs.quietEnd);
  const dirty =
    !sameLabels(labels, state.labels) || aiText !== savedAiText || !sameQuick(quick, savedQuick) || !samePrefs(prefs, state.prefs) || key.trim() !== "" || removeKey || dsKey.trim() !== "" || removeDsKey || groqKey.trim() !== "" || removeGroqKey || autoTranscribe !== state.groq.autoTranscribe || autoSummarize !== state.groq.autoSummarize || auto !== state.jev.autoClassify || classifier !== state.classifier.provider;

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
      if (groqKey.trim()) settings.groqApiKey = groqKey.trim();
      else if (removeGroqKey) settings.groqApiKey = null;
      if (autoTranscribe !== state.groq.autoTranscribe) settings.autoTranscribe = autoTranscribe;
      if (autoSummarize !== state.groq.autoSummarize) settings.autoSummarize = autoSummarize;
      if (auto !== state.jev.autoClassify) settings.autoClassify = auto;
      if (classifier !== state.classifier.provider) settings.classifyProvider = classifier;
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
          <Button variant="ghost" icon={<X size={18} aria-hidden />} aria-label="Fechar configurações" onClick={requestClose} disabled={saving} />
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
                <h3 className="eyebrow">Aparência</h3>
                <SegmentedControl
                  aria-label="Tema"
                  options={THEMES.map((t) => ({
                    value: t.id,
                    label: (
                      <>
                        {t.icon}
                        {t.label}
                      </>
                    ),
                  }))}
                  value={prefs.theme}
                  onChange={(id) => setPref("theme", id)}
                />
                <p className="hint">{prefs.theme === "system" ? "Acompanha o modo claro ou escuro do Windows." : "Vale só para este computador."}</p>
              </section>
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
                <h3 className="eyebrow">Privacidade</h3>
                <Toggle
                  checked={prefs.sendTyping}
                  onChange={(v) => setPref("sendTyping", v)}
                  label="Mostrar “digitando…” ao contato"
                  hint="Desligado, o contato não vê quando você escreve por aqui. O “digitando…” dele aparece de qualquer jeito."
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
                  <Field label="Das" className="field--time">
                    <Input type="time" value={prefs.quietStart ?? ""} onChange={(e) => setPref("quietStart", e.target.value || null)} />
                  </Field>
                  <Field label="Até" className="field--time">
                    <Input type="time" value={prefs.quietEnd ?? ""} onChange={(e) => setPref("quietEnd", e.target.value || null)} />
                  </Field>
                </div>
              )}
            </section>
          )}

          {tab === "ia" && (
            <section className="surface stack">
              <h3 className="eyebrow">Classificação</h3>
              <SegmentedControl
                aria-label="Quem classifica as conversas"
                options={(
                  [
                    ["jev", "Jev"],
                    ["deepseek", "DeepSeek"],
                  ] as const
                ).map(([id, label]) => ({ value: id, label }))}
                value={classifier}
                onChange={(id) => setClassifier(id)}
              />
              <p className="hint">
                {classifier === "jev"
                  ? "O Jev devolve etiqueta, se espera resposta, urgência e prioridade (alta, média ou baixa)."
                  : "A DeepSeek devolve o mesmo que o Jev e ainda o motivo da prioridade em uma frase. Usa a chave da seção Rascunho e resumo."}{" "}
                Sem chave do escolhido, o app usa o outro que tiver chave.
              </p>
              {state.jev.fromEnv ? (
                <p className="hint">A chave do Jev está definida no arquivo .env.local deste computador.</p>
              ) : (
                <Field label="Chave de API do Jev" hint={state.jev.configured ? "A chave fica salva só neste computador e nunca volta para a tela." : "Sem chave, a classificação automática fica desligada."}>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={state.jev.configured ? "Chave salva. Cole outra para trocar." : "Cole a chave do Jev"}
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setRemoveKey(false);
                    }}
                  />
                </Field>
              )}
              {state.jev.configured && !state.jev.fromEnv && (
                <Toggle checked={removeKey} onChange={setRemoveKey} label="Remover a chave salva" />
              )}
              <Toggle
                checked={auto}
                onChange={setAuto}
                label="Classificar sozinho quando chegar mensagem nova"
                hint="Espera 15 s sem mensagens novas na conversa e classifica uma vez."
              />
              {classifier === "jev" && liveAi && <JevContextField ai={liveAi} onChange={publishAi} />}
              <p className="hint">
                A IA recebe o nome do contato e o texto das últimas {classifier === "jev" ? (liveAi?.jev.contextMessages ?? 30) : (liveAi?.deepseek.options.contextMessages ?? 120)} mensagens da conversa; nenhum
                identificador do WhatsApp sai do seu PC.
              </p>
            </section>
          )}
          {tab === "ia" && (
            <section className="surface stack">
              <h3 className="eyebrow">Rascunho de mensagem</h3>
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
          {tab === "ia" && (
            <section className="surface stack">
              <h3 className="eyebrow">Resumo (conversa e áudio)</h3>
              <SummaryModelPanel />
            </section>
          )}
          {tab === "ia" && (
            <section className="surface stack">
              <h3 className="eyebrow">Transcrição de áudio</h3>
              {state.groq.fromEnv ? (
                <p className="hint">A chave da Groq está definida no arquivo .env.local deste computador.</p>
              ) : (
                <Field label="Chave de API da Groq" hint={state.groq.configured ? "A chave fica salva só neste computador e nunca volta para a tela." : "Crie a chave em console.groq.com › API Keys. Usa Whisper Large v3 Turbo (cerca de US$ 0,04 por hora de áudio)."}>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={state.groq.configured ? "Chave salva. Cole outra para trocar." : "Cole a chave (gsk_…)"}
                    value={groqKey}
                    onChange={(e) => {
                      setGroqKey(e.target.value);
                      setRemoveGroqKey(false);
                    }}
                  />
                </Field>
              )}
              {state.groq.configured && !state.groq.fromEnv && <Toggle checked={removeGroqKey} onChange={setRemoveGroqKey} label="Remover a chave salva" />}
              <Toggle
                checked={autoTranscribe}
                onChange={setAutoTranscribe}
                label="Transcrever automaticamente os áudios recebidos"
                hint="Cada conversa pode seguir esta opção ou escolher Sempre/Nunca em Organizar."
              />
              <Toggle
                checked={autoSummarize}
                onChange={setAutoSummarize}
                label="Resumir automaticamente os áudios transcritos"
                hint="Só áudios com 15 segundos ou mais; usa a IA do resumo."
              />
              <p className="hint">Só o arquivo do áudio vai para a Groq. O texto fica salvo neste PC e nenhum áudio é cobrado duas vezes.</p>
            </section>
          )}

          {tab === "gastos" && (
            <section className="surface stack">
              <h3 className="eyebrow">Gastos com IA</h3>
              <AiUsagePanel notify={notify} />
            </section>
          )}

          {tab === "etiquetas" && (
            <section className="surface stack">
              <h3 className="eyebrow">Etiquetas</h3>
              <p className="hint">A descrição orienta o Jev. Escreva o que entra em cada etiqueta.</p>
              <ul className="labels-editor">
                {labels.map((l, i) => (
                  <li key={i} className="labels-editor__row">
                    <Input
                        aria-label={`Nome da etiqueta ${i + 1}`}
                        value={l.name}
                        maxLength={40}
                        placeholder="Nome"
                        onChange={(e) => setLabels((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                    <Input
                        aria-label={`Descrição da etiqueta ${i + 1}`}
                        value={l.description}
                        maxLength={300}
                        placeholder="O que entra nesta etiqueta"
                        onChange={(e) => setLabels((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                      />
                    <Button
                      variant="ghost"
                      icon={<Trash2 size={16} aria-hidden />}
                      aria-label={`Remover etiqueta ${l.name || i + 1}`}
                      disabled={labels.length <= 2}
                      onClick={() => setLabels((ls) => ls.filter((_, j) => j !== i))}
                    />
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                size="compact"
                icon={<Plus size={16} aria-hidden />}
                disabled={labels.length >= 30}
                onClick={() => setLabels((ls) => [...ls, { name: "", description: "" }])}
              >
                Adicionar etiqueta
              </Button>
            </section>
          )}

          {tab === "respostas" && (
            <section className="surface stack">
              <h3 className="eyebrow">Respostas rápidas</h3>
              <p className="hint">Na conversa, digite / e o atalho (ex.: /pix) ou use o botão de raio. {"{nome}"} vira o primeiro nome do contato.</p>
              <ul className="labels-editor">
                {quick.map((q, i) => (
                  <li key={i} className="labels-editor__row">
                    <Input aria-label={`Atalho ${i + 1}`} value={q.shortcut} maxLength={30} placeholder="atalho" onChange={(e) => setQuick((l) => l.map((x, j) => (j === i ? { ...x, shortcut: e.target.value } : x)))} />
                    <Textarea aria-label={`Texto ${i + 1}`} className="quick-editor__text" rows={2} value={q.text} placeholder="Texto da mensagem" onChange={(e) => setQuick((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                    <Button variant="ghost" icon={<Trash2 size={16} aria-hidden />} aria-label={`Remover resposta /${q.shortcut || i + 1}`} onClick={() => setQuick((l) => l.filter((_, j) => j !== i))} />
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="compact" icon={<Plus size={16} aria-hidden />} disabled={quick.length >= 100} onClick={() => setQuick((l) => [...l, { shortcut: "", text: "" }])}>
                Adicionar resposta rápida
              </Button>
              <Button
                variant="ghost"
                size="compact"
                icon={<Briefcase size={16} aria-hidden />}
                disabled={importingQuick || !sameQuick(quick, savedQuick)}
                title={sameQuick(quick, savedQuick) ? undefined : "Salve as alterações antes de importar."}
                onClick={async () => {
                  setImportingQuick(true);
                  try {
                    const r = await api.importQuickReplies();
                    setQuick(r.list);
                    setSavedQuick(r.list);
                    notify("success", r.found ? `WhatsApp Business: ${r.added} nova(s), ${r.updated} atualizada(s).` : "Nenhuma resposta rápida encontrada no WhatsApp Business.");
                  } catch (e) {
                    notify("error", (e as Error).message);
                  } finally {
                    setImportingQuick(false);
                  }
                }}
              >
                {importingQuick ? "Importando…" : "Importar do WhatsApp Business"}
              </Button>
            </section>
          )}

          {tab === "conta" && isDesktop && <AccountsPanel />}
          {tab === "conta" && (
            <section className="surface stack">
              <h3 className="eyebrow">Conta e dados</h3>
              <p className="hint">
                {connected && state.connection.me
                  ? `Conectado como +${state.connection.me.split("@")[0]}.`
                  : "Nenhum WhatsApp conectado agora."}{" "}
                Cada conta tem a sua caixa de entrada: ao trocar o número desta conta, as conversas do anterior saem deste computador.
                {isDesktop && " Para usar outro número junto, adicione outra conta."}
              </p>
              {confirm === "logout" || confirm === "reset" ? (
                <div className="alert alert--danger stack" role="alert">
                  <p>
                    {confirm === "logout"
                      ? "Desconectar este número? Depois leia o QR com o número que quer usar. Se for outro número, as conversas atuais são apagadas deste computador."
                      : "Apagar todas as conversas deste computador e ler o QR de novo? O histórico do número conectado volta pelo WhatsApp. Etiquetas e configurações ficam."}
                  </p>
                  <div className="cluster">
                    <Button variant="secondary" onClick={() => setConfirm(null)} disabled={loggingOut}>
                      Cancelar
                    </Button>
                    <Button variant="danger" onClick={() => accountAction(confirm)} loading={loggingOut}>
                      {confirm === "logout" ? "Desconectar" : "Apagar e reconectar"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="cluster">
                  <Button variant="secondary" disabled={!connected} onClick={() => setConfirm("logout")}>
                    Trocar de número
                  </Button>
                  <Button variant="secondary" icon={<Trash2 size={16} aria-hidden />} onClick={() => setConfirm("reset")}>
                    Apagar conversas e reconectar
                  </Button>
                  <a className={buttonClassName({ variant: "ghost" })} href="/api/backup" download>
                    <Download size={16} aria-hidden /> <span className="bt-button__label">Baixar backup</span>
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
                <Button variant="secondary" onClick={() => setConfirm(null)} autoFocus>
                  Continuar editando
                </Button>
                <Button variant="danger" onClick={onClose}>
                  Descartar
                </Button>
              </div>
            </div>
          ) : (
            <div className="cluster drawer__actions">
              <Button variant="secondary" onClick={requestClose} disabled={saving}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={save} disabled={!dirty} loading={saving}>
                Salvar alterações
              </Button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
