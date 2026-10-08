import { Crosshair, ListChecks, LoaderCircle, MapPin, MessageSquarePlus, Plus, Star, Sticker, Trash2, UserRoundPlus, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Chat, type Message } from "./api.ts";
import { Avatar } from "./avatar.tsx";
import { Alert, Button, Dialog, Field, Input, SearchBox, SegmentedControl, Switch, Textarea } from "./ds/index.ts";
import { listTime, normalize } from "./format.ts";
import { parseLocation, phoneDigits } from "./location.ts";

/**
 * Caixa de formulário: fecha por X, Esc ou clique fora. Com alteração não salva, pergunta antes
 * ("Descartar alterações?"); enquanto envia, não fecha.
 */
function FormModal({ title, icon, dirty, busy, onClose, children, footer, wide }: {
  title: string;
  icon: ReactNode;
  dirty: boolean;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const tryClose = () => {
    if (busy) return;
    if (dirty) setAsking(true);
    else onClose();
  };
  const tryCloseRef = useRef(tryClose);
  tryCloseRef.current = tryClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("input, textarea, button:not([aria-label='Fechar'])")?.focus());
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A confirmação (dialog nativo) cuida do próprio Esc.
      if (asking) return;
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        tryCloseRef.current();
      }
      if (e.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>("input:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex='0']")];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);

  return (
    <div className="modal">
      <div className="modal__overlay" onClick={tryClose} />
      <div ref={panel} className={`modal__panel surface form-dialog${wide ? " form-dialog--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="form-dialog__head">
          <h2 className="heading-card form-dialog__title">
            {icon}
            {title}
          </h2>
          <Button variant="ghost" size="compact" icon={<X size={18} aria-hidden />} aria-label="Fechar" disabled={busy} onClick={tryClose} />
        </div>
        <div className="form-dialog__body">{children}</div>
        {footer && <div className="form-dialog__foot">{footer}</div>}
      </div>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Descartar alterações?"
        tone="danger"
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Continuar editando
            </Button>
            <Button variant="danger" onClick={onClose}>
              Descartar
            </Button>
          </>
        }
      >
        O que você preencheu aqui será perdido.
      </Dialog>
    </div>
  );
}

/** Contatos (conversas individuais com número) para escolher; marcados aparecem primeiro. */
function ContactPicker({ selected, onToggle, exclude = [], label }: { selected: string[]; onToggle: (chat: Chat) => void; exclude?: string[]; label: string }) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.chats().then(setChats).catch((e: Error) => setError(e.message));
  }, []);
  const list = useMemo(() => {
    const q = normalize(query.trim());
    return (chats ?? [])
      .filter((c) => !c.isGroup && c.phone && !exclude.includes(c.jid))
      .filter((c) => !q || normalize(`${c.name} ${c.phone ?? ""}`).includes(q))
      .sort((a, b) => Number(selected.includes(b.jid)) - Number(selected.includes(a.jid)))
      .slice(0, 80);
  }, [chats, query, selected, exclude]);
  return (
    <div className="picker">
      <SearchBox size="compact" aria-label={`Buscar em ${label.toLowerCase()}`} placeholder="Nome ou número" value={query} onChange={setQuery} />
      {error && (
        <Alert tone="danger" role="alert">
          Não foi possível carregar os contatos. {error}
        </Alert>
      )}
      {chats === null && !error ? (
        <p className="hint picker__empty">
          <LoaderCircle className="spin" size={16} aria-hidden /> Carregando contatos…
        </p>
      ) : list.length === 0 ? (
        <p className="hint picker__empty">Nenhum contato encontrado. Só aparecem contatos com quem você já conversou.</p>
      ) : (
        <ul className="picker__list" aria-label={label}>
          {list.map((c) => (
            <li key={c.jid}>
              <label className="picker__item">
                <input type="checkbox" className="picker__check" checked={selected.includes(c.jid)} onChange={() => onToggle(c)} />
                <Avatar jid={c.jid} name={c.name} className="avatar--sm" />
                <span className="picker__name">
                  {c.name}
                  <span className="hint">+{c.phone}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PollDialog({ onSend, onClose }: { onSend: (poll: { question: string; options: string[]; multiple: boolean }) => Promise<void>; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter na última opção cria outra e leva o foco para ela.
  const editor = useRef<HTMLFieldSetElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    const inputs = editor.current?.querySelectorAll<HTMLInputElement>("input");
    inputs?.[inputs.length - 1]?.focus();
  }, [options.length]);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const repeated = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const ready = !!question.trim() && filled.length >= 2 && !repeated;
  const dirty = !!question.trim() || filled.length > 0;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend({ question: question.trim(), options: filled, multiple });
      onClose();
    } catch (e) {
      setError(`Enquete não enviada. ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <FormModal
      title="Criar enquete"
      icon={<ListChecks size={18} aria-hidden />}
      dirty={dirty}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>
            Enviar enquete
          </Button>
        </>
      }
    >
      <Field label="Pergunta" required>
        <Input value={question} maxLength={255} placeholder="Ex.: Qual horário fica melhor?" onChange={(e) => setQuestion(e.target.value)} />
      </Field>
      <fieldset ref={editor} className="poll-editor">
        <legend className="bt-field__label">Opções (de 2 a 12)</legend>
        {options.map((o, i) => (
          <div key={i} className="poll-editor__row">
            <Input
              aria-label={`Opção ${i + 1}`}
              value={o}
              maxLength={100}
              placeholder={`Opção ${i + 1}`}
              onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (i === options.length - 1 && options.length < 12 && o.trim()) {
                    focusNew.current = true;
                    setOptions((list) => [...list, ""]);
                  }
                }
              }}
            />
            <Button
              variant="ghost"
              size="compact"
              aria-label={`Remover opção ${i + 1}`}
              icon={<Trash2 size={16} aria-hidden />}
              disabled={options.length <= 2}
              onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        {options.length < 12 && (
          <Button
            variant="ghost"
            size="compact"
            icon={<Plus size={16} aria-hidden />}
            onClick={() => {
              focusNew.current = true;
              setOptions((list) => [...list, ""]);
            }}
          >
            Adicionar opção
          </Button>
        )}
        {repeated && <p className="hint hint--warning">Há opções repetidas.</p>}
      </fieldset>
      <Switch checked={multiple} onChange={(e) => setMultiple(e.target.checked)} label="Permitir mais de uma resposta" />
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </FormModal>
  );
}

export function LocationDialog({ onSend, onClose }: { onSend: (place: { lat: number; lng: number; name?: string; address?: string }) => Promise<void>; onClose: () => void }) {
  const [where, setWhere] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coords = parseLocation(where);
  const dirty = !!(where.trim() || name.trim() || address.trim());
  const locate = () => {
    if (!navigator.geolocation) return setError("Este computador não informa a localização. Cole um link do mapa ou as coordenadas.");
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setWhere(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        setLocating(false);
      },
      () => {
        setError("Não foi possível obter a localização deste computador. Cole um link do mapa ou as coordenadas.");
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const submit = async () => {
    if (!coords || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend({ ...coords, ...(name.trim() ? { name: name.trim() } : {}), ...(address.trim() ? { address: address.trim() } : {}) });
      onClose();
    } catch (e) {
      setError(`Localização não enviada. ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <FormModal
      title="Enviar localização"
      icon={<MapPin size={18} aria-hidden />}
      dirty={dirty}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={!coords} onClick={() => void submit()}>
            Enviar localização
          </Button>
        </>
      }
    >
      <Field label="Link do mapa ou coordenadas" required hint="Cole o link do Google Maps (Compartilhar › Copiar link) ou “-23.5505, -46.6333”." error={where.trim() && !coords ? "Não achei as coordenadas neste texto." : undefined}>
        <Input value={where} placeholder="https://maps.google.com/…" onChange={(e) => setWhere(e.target.value)} />
      </Field>
      <div className="cluster">
        <Button variant="secondary" size="compact" icon={<Crosshair size={16} aria-hidden />} loading={locating} onClick={locate}>
          Usar a localização deste computador
        </Button>
        {coords && (
          <a className="rich__action" href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">
            Conferir no mapa
          </a>
        )}
      </div>
      <Field label="Nome do local" hint="Opcional. Ex.: Aeroporto de Congonhas, portão 3.">
        <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Endereço" hint="Opcional.">
        <Input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </FormModal>
  );
}

export function ContactDialog({ onSend, onClose }: { onSend: (contacts: { name: string; phone: string }[]) => Promise<void>; onClose: () => void }) {
  const [picked, setPicked] = useState<Chat[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (c: Chat) => setPicked((list) => (list.some((x) => x.jid === c.jid) ? list.filter((x) => x.jid !== c.jid) : [...list, c].slice(0, 20)));
  const submit = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(picked.map((c) => ({ name: c.name, phone: c.phone! })));
      onClose();
    } catch (e) {
      setError(`Contato não enviado. ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <FormModal
      title="Enviar contato"
      icon={<UserRoundPlus size={18} aria-hidden />}
      dirty={picked.length > 0}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={!picked.length} onClick={() => void submit()}>
            {picked.length > 1 ? `Enviar ${picked.length} contatos` : "Enviar contato"}
          </Button>
        </>
      }
    >
      <ContactPicker label="Contatos" selected={picked.map((c) => c.jid)} onToggle={toggle} />
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </FormModal>
  );
}

export function StickerDialog({ onSend, onClose }: { onSend: (from: { chatJid: string; id: string }) => Promise<void>; onClose: () => void }) {
  const [list, setList] = useState<{ chatJid: string; id: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.stickers().then(setList).catch((e: Error) => setError(e.message));
  }, []);
  const send = async (s: { chatJid: string; id: string }) => {
    setBusy(s.id);
    setError(null);
    try {
      await onSend(s);
      onClose();
    } catch (e) {
      setError(`Figurinha não enviada. ${(e as Error).message}`);
      setBusy(null);
    }
  };
  return (
    <FormModal title="Enviar figurinha" icon={<Sticker size={18} aria-hidden />} dirty={false} busy={!!busy} onClose={onClose} wide>
      <p className="hint">Figurinhas que você recebeu ou enviou, das mais recentes.</p>
      {list === null && !error ? (
        <p className="hint picker__empty">
          <LoaderCircle className="spin" size={16} aria-hidden /> Carregando figurinhas…
        </p>
      ) : list && list.length === 0 ? (
        <p className="hint picker__empty">Nenhuma figurinha salva ainda. As que chegarem nas conversas aparecem aqui.</p>
      ) : (
        <ul className="sticker-grid" aria-label="Figurinhas">
          {(list ?? []).map((s) => (
            <li key={`${s.chatJid}/${s.id}`}>
              <button type="button" className="sticker-grid__item" aria-label="Enviar esta figurinha" aria-busy={busy === s.id || undefined} disabled={!!busy} onClick={() => void send(s)}>
                <img src={`/api/media/${encodeURIComponent(s.chatJid)}/${encodeURIComponent(s.id)}`} alt="" loading="lazy" />
                {busy === s.id && <LoaderCircle className="spin sticker-grid__busy" size={20} aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </FormModal>
  );
}

/** Nova conversa por número ou novo grupo com contatos já conhecidos. */
export function NewChatDialog({ onOpen, onClose }: { onOpen: (chat: Chat) => void; onClose: () => void }) {
  const [mode, setMode] = useState<"contato" | "grupo">("contato");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = phoneDigits(phone);
  const ready = mode === "contato" ? !!digits : !!subject.trim() && picked.length > 0;
  const dirty = !!phone.trim() || !!subject.trim() || picked.length > 0;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chat = mode === "contato" ? await api.openChat({ phone }) : await api.createGroup(subject.trim(), picked);
      onOpen(chat);
      onClose();
    } catch (e) {
      setError(`${mode === "contato" ? "Não foi possível abrir a conversa." : "Grupo não criado."} ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <FormModal
      title={mode === "contato" ? "Nova conversa" : "Novo grupo"}
      icon={mode === "contato" ? <MessageSquarePlus size={18} aria-hidden /> : <Users size={18} aria-hidden />}
      dirty={dirty}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>
            {mode === "contato" ? "Abrir conversa" : picked.length ? `Criar grupo com ${picked.length}` : "Criar grupo"}
          </Button>
        </>
      }
    >
      <SegmentedControl
        aria-label="Tipo de conversa"
        fullWidth
        size="compact"
        value={mode}
        onChange={(v) => {
          setMode(v);
          setError(null);
        }}
        options={[
          { value: "contato", label: "Com um número" },
          { value: "grupo", label: "Grupo" },
        ]}
      />
      {mode === "contato" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label="Número do WhatsApp"
            required
            hint="DDD e número. Para fora do Brasil, comece com + e o código do país."
            error={phone.trim() && !digits ? "Número incompleto ou com dígitos demais." : undefined}
          >
            <Input value={phone} inputMode="tel" autoComplete="off" placeholder="(11) 99999-0000" onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </form>
      ) : (
        <>
          <Field label="Nome do grupo" required>
            <Input value={subject} maxLength={100} placeholder="Ex.: Evento 12/10 · Motoristas" onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <ContactPicker label="Participantes" selected={picked} onToggle={(c) => setPicked((list) => (list.includes(c.jid) ? list.filter((j) => j !== c.jid) : [...list, c.jid]))} />
        </>
      )}
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </FormModal>
  );
}

/** Adicionar pessoas a um grupo (o resultado de cada uma volta do WhatsApp). */
export function AddParticipantsDialog({ groupName, exclude, onAdd, onClose }: { groupName: string; exclude: string[]; onAdd: (jids: string[]) => Promise<void>; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(picked);
      onClose();
    } catch (e) {
      setError(`Não foi possível adicionar. ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <FormModal
      title={`Adicionar a ${groupName}`}
      icon={<UserRoundPlus size={18} aria-hidden />}
      dirty={picked.length > 0}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={!picked.length} onClick={() => void submit()}>
            {picked.length > 1 ? `Adicionar ${picked.length} pessoas` : "Adicionar"}
          </Button>
        </>
      }
    >
      <ContactPicker label="Contatos" exclude={exclude} selected={picked} onToggle={(c) => setPicked((list) => (list.includes(c.jid) ? list.filter((j) => j !== c.jid) : [...list, c.jid]))} />
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </FormModal>
  );
}

/** Mensagens favoritas de todas as conversas; o clique abre a conversa nela. */
export function StarredDialog({ chats, onOpenAt, onClose }: { chats: Map<string, Chat>; onOpenAt: (jid: string, id: string) => void; onClose: () => void }) {
  const [list, setList] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.starred().then(setList).catch((e: Error) => setError(e.message));
  }, []);
  const unstar = async (m: Message) => {
    setList((l) => l && l.filter((x) => !(x.id === m.id && x.chatJid === m.chatJid)));
    try {
      await api.star(m.chatJid, m.id, false);
    } catch (e) {
      setList((l) => (l ? [m, ...l].sort((a, b) => b.at - a.at) : l));
      setError(`Não foi possível desfavoritar. ${(e as Error).message}`);
    }
  };
  return (
    <FormModal title="Mensagens favoritas" icon={<Star size={18} aria-hidden />} dirty={false} busy={false} onClose={onClose} wide>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {list === null && !error ? (
        <p className="hint picker__empty">
          <LoaderCircle className="spin" size={16} aria-hidden /> Carregando favoritas…
        </p>
      ) : list && list.length === 0 ? (
        <p className="hint picker__empty">Nenhuma mensagem favorita. Use Favoritar no menu da mensagem (botão direito).</p>
      ) : (
        <ul className="starred" aria-label="Favoritas">
          {(list ?? []).map((m) => (
            <li key={`${m.chatJid}/${m.id}`} className="starred__item">
              <button
                type="button"
                className="starred__open"
                onClick={() => {
                  onOpenAt(m.chatJid, m.id);
                  onClose();
                }}
              >
                <span className="starred__row">
                  <span className="starred__chat">{chats.get(m.chatJid)?.name ?? "Conversa"}</span>
                  <span className="hint">{listTime(m.at)}</span>
                </span>
                <span className="starred__text">
                  {m.fromMe && <span className="chat-item__me">Você: </span>}
                  {m.text}
                </span>
              </button>
              <Button variant="ghost" size="compact" aria-label="Desfavoritar" title="Desfavoritar" icon={<Star size={16} aria-hidden className="is-starred" />} onClick={() => void unstar(m)} />
            </li>
          ))}
        </ul>
      )}
    </FormModal>
  );
}

/** Editar nome ou descrição do grupo. */
export function GroupInfoDialog({ field, current, onSave, onClose }: { field: "subject" | "description"; current: string; onSave: (value: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subject = field === "subject";
  const ready = subject ? !!value.trim() && value.trim() !== current : value.trim() !== current.trim();
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(value.trim());
      onClose();
    } catch (e) {
      setError(`Não foi possível salvar. ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <FormModal
      title={subject ? "Nome do grupo" : "Descrição do grupo"}
      icon={<Users size={18} aria-hidden />}
      dirty={value !== current}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>
            Salvar para todos
          </Button>
        </>
      }
    >
      <Field label={subject ? "Nome" : "Descrição"} required={subject} hint="Todos os participantes veem a mudança.">
        {subject ? (
          <Input value={value} maxLength={100} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <Textarea value={value} rows={5} maxLength={2048} onChange={(e) => setValue(e.target.value)} />
        )}
      </Field>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </FormModal>
  );
}

