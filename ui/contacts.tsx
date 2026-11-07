import { ArrowLeft, Check, Copy, LoaderCircle, MessageSquareText, Pencil, Trash2, UserRound, UserRoundPen, UserRoundPlus, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Chat, type ContactCard } from "./api.ts";
import { Avatar } from "./avatar.tsx";
import { contactSections, markDeleted, markSaved, refreshContacts, splitName, useContacts } from "./contact-list.ts";
import { FormModal } from "./dialogs.tsx";
import { Alert, Button, Dialog, Field, Input, SearchBox } from "./ds/index.ts";
import { initials } from "./format.ts";
import { ChatPicker } from "./forward.tsx";
import { phoneDigits } from "./location.ts";

/** Quem salvar ou editar: telefone com "+" e DDI quando conhecido; `savedName` abre em edição. */
export type ContactTarget = { phone?: string; name?: string; savedName?: string | null };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Número só com dígitos para abrir conversa: o waid do WhatsApp ou o telefone do cartão. */
export function contactDigits(c: ContactCard): string | null {
  const p = c.phones[0];
  if (!p) return null;
  const digits = (p.wa ?? p.number).replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** Cartão de contato na bolha, como no WhatsApp: nome, número e "Conversar". */
export function ContactCards({ contacts, onOpen, onCopy, onSave }: {
  contacts: ContactCard[];
  onOpen: (digits: string) => void;
  onCopy: (text: string) => void;
  /** "Salvar contato" para quem ainda não está na agenda. */
  onSave: (target: ContactTarget) => void;
}) {
  const { contacts: saved } = useContacts();
  return (
    <div className="contact-cards">
      {contacts.map((c, i) => {
        const digits = contactDigits(c);
        const number = c.phones[0]?.number ?? null;
        return (
          <div key={i} className="contact-card">
            <div className="contact-card__info">
              <span className="avatar contact-card__avatar" aria-hidden>
                {c.name ? initials(c.name) : <UserRound size={18} />}
              </span>
              <span className="contact-card__text">
                <span className="contact-card__name">{c.name}</span>
                {number && <span className="contact-card__phone">{number}</span>}
                {c.phones.length > 1 && <span className="contact-card__phone">+{c.phones.length - 1} número(s)</span>}
              </span>
            </div>
            <div className="contact-card__actions">
              <button type="button" className="contact-card__action" disabled={!digits} title={digits ? undefined : "Este contato não tem número"} onClick={() => digits && onOpen(digits)}>
                <MessageSquareText size={15} aria-hidden /> Conversar
              </button>
              {digits && !saved?.some((x) => x.phone === digits) && (
                <button type="button" className="contact-card__action" onClick={() => onSave({ phone: c.phones[0]?.wa ? `+${digits}` : c.phones[0]!.number, name: c.name })}>
                  <UserRoundPlus size={15} aria-hidden /> Salvar contato
                </button>
              )}
              {number && (
                <button type="button" className="contact-card__action" onClick={() => onCopy(c.phones.map((p) => `${c.name}: ${p.number}`).join("\n"))}>
                  <Copy size={15} aria-hidden /> Copiar número
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Escolhe contatos (conversas individuais com número) e envia como cartão. */
export function ContactPicker({ to, onClose, onDone }: { to: Chat; onClose: () => void; onDone: (n: number) => void }) {
  return (
    <ChatPicker
      title="Enviar contato"
      max={10}
      filter={(c) => !c.isGroup && !!c.phone && c.jid !== to.jid}
      sendLabel={(n) => (n > 1 ? `Enviar ${n} contatos` : "Enviar contato")}
      onClose={onClose}
      onSend={async (picked) => {
        try {
          await api.sendContacts(to.jid, picked.map((c) => ({ name: c.name, phone: c.phone! })));
        } catch (e) {
          throw new Error(`Não foi possível enviar. ${(e as Error).message}`);
        }
        onDone(picked.length);
      }}
    />
  );
}

type NumberCheck = { state: "idle" | "checking" | "error" } | { state: "missing" } | { state: "ok"; savedName: string | null };

/** Novo contato ou edição, como no WhatsApp: grava na conta primeiro; o número não muda depois de salvo. */
export function ContactForm({ target, connected, onClose, notify }: {
  target: ContactTarget;
  connected: boolean;
  onClose: () => void;
  notify: (kind: "error" | "success", text: string) => void;
}) {
  const initial = useMemo(() => splitName(target.savedName ?? target.name ?? ""), [target]);
  const [editing, setEditing] = useState(!!target.savedName);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phone, setPhone] = useState(target.phone ?? "");
  const [check, setCheck] = useState<NumberCheck>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const seq = useRef(0);
  const closeTimer = useRef<number | undefined>(undefined);
  const digits = phoneDigits(phone);
  const dirty = firstName !== initial.firstName || lastName !== initial.lastName || phone !== (target.phone ?? "");

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Confere o número 400 ms depois da última tecla; resposta velha é descartada.
  useEffect(() => {
    const n = ++seq.current;
    if (editing || !digits || !connected) return setCheck({ state: "idle" });
    setCheck({ state: "checking" });
    const timer = window.setTimeout(() => {
      api.checkContact(`+${digits}`).then(
        (r) => n === seq.current && setCheck(r.jid ? { state: "ok", savedName: r.savedName } : { state: "missing" }),
        // Falha na consulta não bloqueia: o salvamento confere de novo.
        () => n === seq.current && setCheck({ state: "error" }),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [digits, editing, connected]);

  const existing = !editing && check.state === "ok" ? check.savedName : null;
  const ready = connected && !!firstName.trim() && !!digits && check.state !== "missing" && check.state !== "checking" && !existing && (!editing || dirty) && !done;
  const offline = connected ? undefined : "Conecte o WhatsApp para salvar.";

  const finish = (text: string) => {
    setDone(true);
    notify("success", text);
    closeTimer.current = window.setTimeout(onClose, reducedMotion() ? 0 : 400);
  };

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const contact = await api.saveContact({ phone: `+${digits}`, firstName: firstName.trim(), lastName: lastName.trim() || undefined });
      markSaved(contact);
      setBusy(false);
      finish("Contato salvo.");
    } catch (e) {
      setError(`Não foi possível salvar. ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!digits) return;
    setConfirmDelete(false);
    setBusy(true);
    setError(null);
    try {
      const jid = `${digits}@s.whatsapp.net`;
      await api.deleteContact(jid);
      markDeleted(jid);
      setBusy(false);
      finish("Contato excluído.");
    } catch (e) {
      setError(`Não foi possível excluir. ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const editExisting = (name: string) => {
    const parts = splitName(name);
    setFirstName(parts.firstName);
    setLastName(parts.lastName);
    setEditing(true);
  };

  const phoneHint =
    editing ? "Para trocar o número, exclua e crie outro contato."
    : check.state === "checking" ? "Verificando…"
    : existing ? undefined
    : "DDD e número. Para fora do Brasil, comece com + e o código do país.";

  return (
    <FormModal
      title={editing ? "Editar contato" : "Novo contato"}
      icon={editing ? <UserRoundPen size={18} aria-hidden /> : <UserRoundPlus size={18} aria-hidden />}
      dirty={dirty && !done}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <Button variant="danger" className="contact-form__delete" icon={<Trash2 size={16} aria-hidden />} disabled={!connected || busy || done} title={offline} onClick={() => setConfirmDelete(true)}>
              Excluir contato
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className={done ? "contact-form__saved" : undefined}
            loading={busy}
            disabled={!ready}
            title={offline}
            icon={done ? <Check size={16} aria-hidden /> : undefined}
            onClick={() => void save()}
          >
            {done ? "Salvo" : "Salvar"}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Nome" required>
          <Input value={firstName} maxLength={100} autoComplete="off" onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Sobrenome">
          <Input value={lastName} maxLength={100} autoComplete="off" onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field
          label="Telefone"
          required
          hint={phoneHint}
          error={
            phone.trim() && !digits ? "Número incompleto ou com dígitos demais."
            : check.state === "missing" ? "Este número não tem WhatsApp."
            : undefined
          }
        >
          <Input value={phone} inputMode="tel" autoComplete="off" placeholder="(11) 99999-0000" readOnly={editing} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {existing && (
          <p className="hint contact-form__existing">
            Já salvo como <strong>{existing}</strong>.
            <Button variant="ghost" size="compact" icon={<Pencil size={14} aria-hidden />} onClick={() => editExisting(existing)}>
              Editar
            </Button>
          </p>
        )}
        <button type="submit" hidden />
      </form>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Excluir ${[firstName, lastName].filter(Boolean).join(" ") || "contato"}?`}
        tone="danger"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Excluir
            </Button>
          </>
        }
      >
        O contato sai da sua agenda. A conversa continua aqui.
      </Dialog>
    </FormModal>
  );
}

/** "Nova conversa": agenda em ordem alfabética, como no WhatsApp; desliza sobre a lista de conversas. */
export function ContactsPanel({ paused, onClose, onOpen, onNewContact, onNewGroup }: {
  /** Formulário aberto por cima: o Esc é dele. */
  paused: boolean;
  onClose: () => void;
  onOpen: (target: { phone: string }) => void;
  onNewContact: (target: ContactTarget) => void;
  onNewGroup: () => void;
}) {
  const { contacts, error, recent } = useContacts();
  const [query, setQuery] = useState("");
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const sections = useMemo(() => contactSections(contacts ?? [], query), [contacts, query]);
  const number = phoneDigits(query);
  const close = () => (reducedMotion() ? onClose() : setClosing(true));
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    void refreshContacts().catch(() => undefined);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused]);

  return (
    <aside
      ref={panel}
      className="contacts-panel"
      data-closing={closing || undefined}
      aria-label="Nova conversa"
      onAnimationEnd={(e) => e.target === e.currentTarget && closing && onClose()}
    >
      <header className="contacts-panel__header">
        <Button variant="ghost" size="compact" icon={<ArrowLeft size={18} aria-hidden />} aria-label="Voltar para as conversas" onClick={close} />
        <h2 className="heading-card">Nova conversa</h2>
      </header>
      <div className="contacts-panel__search">
        <SearchBox size="compact" aria-label="Buscar contato" placeholder="Nome ou número" value={query} onChange={setQuery} />
      </div>
      <div className="contacts-panel__list">
        {!query.trim() && (
          <div className="contacts-panel__actions">
            <button type="button" className="contacts-panel__row" onClick={onNewGroup}>
              <span className="avatar avatar--sm contacts-panel__icon" aria-hidden>
                <Users size={16} />
              </span>
              <span className="contacts-panel__name">Novo grupo</span>
            </button>
            <button type="button" className="contacts-panel__row" onClick={() => onNewContact({})}>
              <span className="avatar avatar--sm contacts-panel__icon" aria-hidden>
                <UserRoundPlus size={16} />
              </span>
              <span className="contacts-panel__name">Novo contato</span>
            </button>
          </div>
        )}
        {error && (
          <Alert tone="danger" role="alert">
            Não foi possível carregar os contatos. {error}{" "}
            <Button variant="ghost" size="compact" onClick={() => void refreshContacts().catch(() => undefined)}>
              Tentar de novo
            </Button>
          </Alert>
        )}
        {contacts === null && !error && (
          <p className="hint contacts-panel__empty">
            <LoaderCircle className="spin" size={16} aria-hidden /> Carregando contatos…
          </p>
        )}
        {number && !sections.length && (
          <button type="button" className="contacts-panel__row" onClick={() => onOpen({ phone: query.trim().startsWith("+") ? query.trim() : `+${number}` })}>
            <span className="avatar avatar--sm contacts-panel__icon" aria-hidden>
              <MessageSquareText size={16} />
            </span>
            <span className="contacts-panel__name">Conversar com +{number}</span>
          </button>
        )}
        {contacts && query.trim() && !number && !sections.length && (
          <p className="hint contacts-panel__empty">
            Nenhum contato com <q>{query.trim()}</q>.
          </p>
        )}
        {contacts && !query.trim() && !contacts.length && <p className="hint contacts-panel__empty">Nenhum contato salvo ainda.</p>}
        {sections.map((s) => (
          <section key={s.letter} aria-label={s.letter}>
            <h3 className="contacts-panel__letter">{s.letter}</h3>
            <ul className="contacts-panel__group">
              {s.contacts.map((c) => (
                <li key={c.jid} className={`contacts-panel__item${recent === c.jid ? " contact-saved" : ""}`}>
                  <button type="button" className="contacts-panel__row" onClick={() => onOpen({ phone: `+${c.phone}` })}>
                    <Avatar jid={c.jid} name={c.name} className="avatar--sm" />
                    <span className="contacts-panel__text">
                      <span className="contacts-panel__name">{c.name}</span>
                      <span className="hint">+{c.phone}</span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="compact"
                    className="contacts-panel__edit"
                    aria-label={`Editar ${c.name}`}
                    title="Editar contato"
                    icon={<Pencil size={14} aria-hidden />}
                    onClick={() => onNewContact({ phone: `+${c.phone}`, name: c.name, savedName: c.name })}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
