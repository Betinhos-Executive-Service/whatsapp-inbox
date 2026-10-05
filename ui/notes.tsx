import { AlarmClock, Check, LoaderCircle, Trash2, WandSparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Chat, type Reminder, type Summary } from "./api.ts";
import { useAiStatus } from "./ai-state.ts";
import { dayLabel, formatTime } from "./format.ts";

const pad = (n: number) => String(n).padStart(2, "0");
/** Valor de <input type="datetime-local"> no horário deste computador. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function presets(now = new Date()): { label: string; at: number }[] {
  const at = (days: number, h: number, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const list = [{ label: "Em 1 hora", at: now.getTime() + 3600_000 }];
  if (now.getHours() < 17) list.push({ label: "Hoje 18:00", at: at(0, 18) });
  list.push({ label: "Amanhã 9:00", at: at(1, 9) });
  return list;
}

export const reminderLabel = (ms: number) => `${dayLabel(ms)} ${formatTime(ms)}`;

/** Painel lateral da conversa: nota interna (salva sozinha) e lembretes. */
export function NotesPanel({ chat, onChat, onClose, notify }: {
  chat: Chat;
  onChat: (c: Chat) => void;
  onClose: () => void;
  notify: (kind: "error" | "success", text: string) => void;
}) {
  const [note, setNote] = useState(chat.note ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600_000));
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ai = useAiStatus();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  useEffect(() => setSummary(null), [chat.jid]);
  const summarize = async () => {
    setSummarizing(true);
    try {
      setSummary(await api.summary(chat.jid));
    } catch (e) {
      notify("error", `A IA local não resumiu. ${(e as Error).message}`);
    } finally {
      setSummarizing(false);
    }
  };
  const lastSaved = useRef(chat.note ?? "");

  // Troca de conversa: recarrega tudo.
  useEffect(() => {
    setNote(chat.note ?? "");
    lastSaved.current = chat.note ?? "";
    setSaveState("idle");
    setReminders(null);
    api.reminders(chat.jid).then(setReminders).catch((e) => notify("error", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.jid]);

  // Lembrete concluído/vencido em outro lugar muda reminderAt: recarrega a lista.
  useEffect(() => {
    api.reminders(chat.jid).then(setReminders).catch(() => undefined);
  }, [chat.jid, chat.reminderAt]);

  const saveNote = async (value: string) => {
    clearTimeout(timer.current);
    if (value === lastSaved.current) return;
    setSaveState("saving");
    try {
      onChat(await api.update(chat.jid, { note: value }));
      lastSaved.current = value;
      setSaveState("saved");
    } catch (e) {
      setSaveState("idle");
      notify("error", `Nota não salva. ${(e as Error).message}`);
    }
  };

  // Salva 800 ms depois da última tecla, e ao sair do campo ou fechar o painel.
  useEffect(() => () => clearTimeout(timer.current), []);
  const onNoteChange = (value: string) => {
    setNote(value);
    setSaveState("idle");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNote(value), 800);
  };

  const add = async (dueAt: number) => {
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
      notify("error", "Escolha uma data e hora no futuro para o lembrete.");
      return;
    }
    setAdding(true);
    try {
      await api.addReminder(chat.jid, dueAt, text);
      setText("");
      setReminders(await api.reminders(chat.jid));
      notify("success", `Lembrete criado para ${reminderLabel(dueAt)}.`);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const finish = async (r: Reminder, mode: "done" | "delete") => {
    try {
      onChat(mode === "done" ? await api.doneReminder(r.id) : await api.deleteReminder(r.id));
      setReminders((list) => list?.filter((x) => x.id !== r.id) ?? null);
    } catch (e) {
      notify("error", (e as Error).message);
    }
  };

  return (
    <aside className="notes" aria-label="Notas e lembretes">
      <header className="notes__header">
        <h3 className="heading-card">Notas e lembretes</h3>
        <button
          className="icon-button icon-button--plain"
          aria-label="Fechar notas e lembretes"
          onClick={() => {
            void saveNote(note);
            onClose();
          }}
        >
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="notes__body">
        <div className="stack">
          <span className="field__label">Resumo (IA local)</span>
          {summary ? (
            <dl className="summary">
              <dt>Resumo</dt>
              <dd>{summary.resumo}</dd>
              {summary.pedido && (
                <>
                  <dt>O que quer</dt>
                  <dd>{summary.pedido}</dd>
                </>
              )}
              {summary.proximoPasso && (
                <>
                  <dt>Próximo passo</dt>
                  <dd>{summary.proximoPasso}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="hint">{ai?.state === "pronto" ? "Gera um resumo das últimas mensagens, sem sair do seu computador." : "Baixe a IA local em Configurações › IA para usar."}</p>
          )}
          <div className="cluster">
            <button className="button button--secondary button--compact" disabled={ai?.state !== "pronto" || summarizing} aria-busy={summarizing || undefined} onClick={() => void summarize()}>
              {summarizing ? <LoaderCircle className="spin" size={16} aria-hidden /> : <WandSparkles size={16} aria-hidden />}
              {summary ? "Resumir de novo" : "Resumir conversa"}
            </button>
          </div>
        </div>
        <label className="field">
          <span className="field__label">Nota interna</span>
          <textarea
            className="notes__note"
            rows={5}
            maxLength={5000}
            value={note}
            placeholder="Só você vê. Ex.: prefere áudio, empresa X, motorista preferido…"
            onChange={(e) => onNoteChange(e.target.value)}
            onBlur={() => void saveNote(note)}
          />
          <span className="hint" role="status">
            {saveState === "saving" ? "Salvando…" : saveState === "saved" ? "Nota salva." : "Salva sozinha enquanto você escreve."}
          </span>
        </label>

        <div className="stack">
          <span className="field__label">Lembretes</span>
          {reminders === null ? (
            <p className="hint" aria-busy="true">
              Carregando lembretes…
            </p>
          ) : reminders.length === 0 ? (
            <p className="hint">Nenhum lembrete. Quando vencer, a conversa volta para Abertas e o app avisa.</p>
          ) : (
            <ul className="reminders">
              {reminders.map((r) => {
                const due = r.dueAt <= Date.now();
                return (
                  <li key={r.id} className={`reminder${due ? " reminder--due" : ""}`}>
                    <AlarmClock size={16} aria-hidden />
                    <span className="reminder__text">
                      <strong>{reminderLabel(r.dueAt)}</strong>
                      {due && <span className="badge badge--warning">Vencido</span>}
                      {r.text && <span className="hint">{r.text}</span>}
                    </span>
                    <button className="icon-button icon-button--plain" aria-label={`Concluir lembrete de ${reminderLabel(r.dueAt)}`} onClick={() => void finish(r, "done")}>
                      <Check size={16} aria-hidden />
                    </button>
                    <button className="icon-button icon-button--plain" aria-label={`Apagar lembrete de ${reminderLabel(r.dueAt)}`} onClick={() => void finish(r, "delete")}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <label className="field">
            <span className="sr-only">Texto do lembrete</span>
            <input value={text} maxLength={300} placeholder="Sobre o quê? (opcional)" onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="cluster">
            {presets().map((p) => (
              <button key={p.label} className="button button--secondary button--compact" disabled={adding} onClick={() => void add(p.at)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="notes__custom">
            <label className="field">
              <span className="sr-only">Data e hora do lembrete</span>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <button className="button button--primary button--compact" disabled={adding || !when} aria-busy={adding || undefined} onClick={() => void add(new Date(when).getTime())}>
              {adding && <LoaderCircle className="spin" size={16} aria-hidden />}
              Lembrar
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
