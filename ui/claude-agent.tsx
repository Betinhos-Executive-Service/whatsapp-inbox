// Botão Claude da conversa: o Claude Code deste PC analisa a conversa (só leitura) e mostra o resumo do
// agendamento; com o seu OK em "Agendar", cria a OS e deixa o voucher e a mensagem como rascunho.
import { CalendarCheck, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { api, type AgentJob, type AgentStep } from "./api.ts";
import { Button } from "./ds/index.ts";
import { WaText } from "./wa-format.tsx";

/** Marca do Claude (asterisco), na cor do texto como os ícones Lucide. */
export function ClaudeMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="m4.71 15.96 4.72-2.65.08-.23-.08-.13h-.23l-.79-.05-2.7-.07-2.34-.1-2.27-.12-.57-.12L0 11.78l.06-.35.48-.32.69.06 1.52.1 2.28.16 1.65.1 2.45.25h.39l.05-.16-.13-.1-.1-.1-2.36-1.6-2.55-1.68-1.34-.97-.72-.5-.36-.46-.16-1 .66-.73.88.06.22.06.9.69 1.9 1.47 2.5 1.84.36.3.15-.1.02-.08-.17-.27-1.35-2.45-1.45-2.49-.64-1.03-.17-.62a3 3 0 0 1-.1-.73L6.28.13 6.7 0l1 .13.42.37.62 1.41 1 2.23 1.56 3.03.46.9.24.83.09.26h.16v-.15l.13-1.7.24-2.1.23-2.7.08-.76.37-.9.75-.5.58.29.48.68-.07.45-.28 1.85-.56 2.9-.37 1.95h.22l.24-.25.98-1.3 1.65-2.07.73-.82.85-.9.55-.43h1.03l.76 1.13-.34 1.17-1.06 1.35-.88 1.14-1.27 1.7-.79 1.36.08.11.18-.02 2.86-.6 1.54-.29 1.84-.31.84.39.09.4-.33.8-1.97.49-2.3.46-3.44.81-.05.03.05.07 1.55.14.66.04h1.62l3.02.22.79.52.47.64-.08.49-1.21.62-1.64-.39-3.83-.91-1.31-.33h-.18v.11l1.09 1.07 2.01 1.81 2.5 2.33.13.58-.32.45-.34-.05-2.2-1.66-.85-.75-1.93-1.62h-.13v.17l.45.65 2.34 3.52.12 1.08-.17.35-.6.21-.67-.12-1.38-1.93-1.41-2.16-1.15-1.94-.14.08-.67 7.25-.32.37-.73.28-.6-.46-.33-.75.33-1.47.38-1.93.32-1.53.28-1.9.17-.63-.01-.04-.14.02-1.43 1.97-2.18 2.94-1.73 1.85-.41.16-.72-.37.07-.66.4-.59 2.39-3.04 1.44-1.88.93-1.09v-.16h-.06l-6.35 4.13-1.13.14-.49-.45.06-.75.23-.24 1.91-1.31z" />
    </svg>
  );
}

// ---- estado ao vivo (evento "agent" do servidor, repassado pelo App como "inbox:agent")

const jobs = new Map<string, AgentJob>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let synced = false;

function sync() {
  api
    .agentJobs()
    .then((list) => {
      jobs.clear();
      for (const job of list) jobs.set(job.jid, job);
      emit();
    })
    .catch(() => undefined);
}

window.addEventListener("inbox:agent", (e) => {
  const { jid, job } = (e as CustomEvent<{ jid: string; job: AgentJob | null }>).detail;
  if (job) jobs.set(jid, job);
  else jobs.delete(jid);
  emit();
});
// Reconectou ao servidor: pode ter perdido eventos.
window.addEventListener("inbox:agent-sync", sync);

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!synced) {
    synced = true;
    sync();
  }
  return () => listeners.delete(listener);
}

export const useAgentJob = (jid: string) => useSyncExternalStore(subscribe, () => jobs.get(jid) ?? null);

type Notify = (tone: "error" | "success", text: string) => void;

async function start(jid: string, step: AgentStep, notify: Notify) {
  try {
    await api.agentStart(jid, step);
  } catch (e) {
    notify("error", `O Claude não começou. ${(e as Error).message}`);
  }
}

async function dismiss(jid: string, notify: Notify) {
  try {
    await api.agentDismiss(jid);
  } catch (e) {
    notify("error", (e as Error).message);
  }
}

export function ClaudeAgentButton({ jid, available, notify }: { jid: string; available: boolean; notify: Notify }) {
  const job = useAgentJob(jid);
  const running = job?.status === "rodando";
  return (
    <Button
      variant="secondary"
      size="compact"
      aria-label="Analisar com o Claude para agendar"
      title={
        !available
          ? "Instale o Claude Code e faça login com `claude` no terminal"
          : running
            ? "O Claude está trabalhando nesta conversa"
            : "Claude: ler a conversa e preparar o agendamento. Nada é gravado antes de você conferir e clicar em Agendar."
      }
      disabled={!available || running}
      aria-busy={running || undefined}
      onClick={() => void start(jid, "analisar", notify)}
      icon={running ? <LoaderCircle className="spin" size={16} aria-hidden /> : <ClaudeMark size={16} />}
    />
  );
}

const MINUTES = "Leva de 1 a 3 minutos; você pode trocar de conversa.";

function Bar({ icon, title, children, actions, tone = "info" }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; tone?: "info" | "success" | "warning" | "danger" }) {
  return (
    <div className={`pending-bar agent-bar agent-bar--${tone}`} role="status" aria-live="polite">
      <span className="agent-bar__icon">{icon}</span>
      <div className="agent-bar__body">
        <span className="quote__author">{title}</span>
        {children}
      </div>
      {actions && <div className="pending-bar__actions">{actions}</div>}
    </div>
  );
}

/** Resumo do Claude acima do campo de mensagem: conferir e agendar, ou o resultado. */
export function AgentBar({ jid, hasDraft, notify }: { jid: string; hasDraft: boolean; notify: Notify }) {
  const job = useAgentJob(jid);
  if (!job) return null;
  const close = (label = "Fechar") => (
    <Button variant="ghost" size="compact" onClick={() => void dismiss(jid, notify)}>
      {label}
    </Button>
  );
  const os = (list: string[]) => (list.length ? ` · ${list.join(", ")}` : "");

  if (job.status === "rodando") {
    return (
      <Bar icon={<LoaderCircle className="spin" size={16} aria-hidden />} title={job.step === "analisar" ? "Claude lendo a conversa e o sistema…" : "Claude agendando e gerando o voucher…"}>
        <span className="hint">{MINUTES}</span>
      </Bar>
    );
  }
  if (job.status === "erro") {
    const retry = job.step === "analisar" || !job.analysis ? "analisar" : "agendar";
    return (
      <Bar
        tone="danger"
        icon={<TriangleAlert size={16} aria-hidden />}
        title={job.step === "analisar" ? "O Claude não conseguiu analisar" : "O Claude não terminou o agendamento"}
        actions={
          <>
            {/* Agendamento que falhou volta para a análise: o Claude confere se algo chegou a ser gravado. */}
            <Button variant="secondary" size="compact" onClick={() => void start(jid, "analisar", notify)}>
              {retry === "agendar" ? "Conferir de novo" : "Tentar de novo"}
            </Button>
            {close()}
          </>
        }
      >
        <span className="agent-bar__text">{job.error}</span>
      </Bar>
    );
  }
  if (job.step === "agendar" && job.scheduled) {
    const s = job.scheduled;
    const ok = s.resultado !== "erro";
    return (
      <Bar
        tone={ok ? "success" : "danger"}
        icon={ok ? <CircleCheck size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
        title={`${s.resultado === "agendado" ? "Agendado" : s.resultado === "ja_existia" ? "Voucher da OS existente" : "Agendamento não concluído"}${os(s.os)}`}
        actions={close()}
      >
        <span className="agent-bar__text">{s.resumo}{ok && hasDraft && " Confira o voucher e a mensagem no rascunho antes de enviar."}</span>
      </Bar>
    );
  }
  const a = job.analysis;
  if (!a) return null;
  if (a.resultado === "pronto") {
    return (
      <Bar
        icon={<CalendarCheck size={16} aria-hidden />}
        title="Confira antes de agendar"
        actions={
          <>
            <Button variant="action" size="compact" onClick={() => void start(jid, "agendar", notify)}>
              Agendar
            </Button>
            {close("Descartar")}
          </>
        }
      >
        <div className="agent-bar__preview">
          <WaText text={a.previa || a.resumo} />
        </div>
        <span className="hint">Ao agendar, o Claude cria a OS como Solicitado e deixa o voucher e a mensagem como rascunho.</span>
      </Bar>
    );
  }
  if (a.resultado === "ja_existia") {
    return (
      <Bar
        tone="warning"
        icon={<Info size={16} aria-hidden />}
        title={`Serviço já agendado${os(a.os)}`}
        actions={
          <>
            <Button variant="action" size="compact" onClick={() => void start(jid, "agendar", notify)}>
              Gerar voucher
            </Button>
            {close()}
          </>
        }
      >
        <span className="agent-bar__text">{a.resumo}</span>
      </Bar>
    );
  }
  return (
    <Bar
      tone={a.resultado === "faltam_dados" ? "warning" : "info"}
      icon={a.resultado === "faltam_dados" ? <TriangleAlert size={16} aria-hidden /> : <Info size={16} aria-hidden />}
      title={a.resultado === "faltam_dados" ? "Faltam dados para agendar" : "Não é um pedido de agendamento"}
      actions={close()}
    >
      <span className="agent-bar__text">
        {a.resumo}
        {a.resultado === "faltam_dados" && hasDraft && " A mensagem pedindo os dados ficou no rascunho."}
      </span>
    </Bar>
  );
}
