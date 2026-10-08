import { CalendarDays, Check, ChevronDown, ExternalLink, ListChecks, LoaderCircle, MapPin, MessageCircle, Phone, PhoneIncoming, PhoneMissed, PhoneOff, Pin, Users, Video, X } from "lucide-react";
import { useState } from "react";
import type { Chat, ContactCard, Extra, Message } from "./api.ts";
import { Button, Dialog } from "./ds/index.ts";
import { initials } from "./format.ts";
import { WaInline } from "./wa-format.tsx";

/** Ações que os conteúdos ricos pedem à conversa. */
export type RichActions = {
  onVote: (m: Message, options: string[]) => void;
  /** Abrir (ou começar) a conversa com um número. */
  onOpenPhone: (phone: string) => void;
  onAcceptInvite: (m: Message) => void;
};

/** Tipos que a bolha mostra com um cartão próprio no lugar do texto "[Enquete] …". */
export const isRich = (m: Message) => !m.deleted && !!m.extra && m.extra.type !== "link";

const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

const formatPhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  const m = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : raw.startsWith("+") ? raw : `+${digits}`;
};

export function RichContent({ m, canAct, actions }: { m: Message; canAct: boolean; actions: RichActions }) {
  const extra = m.extra;
  if (!extra) return null;
  switch (extra.type) {
    case "poll":
      return <PollView m={m} poll={extra} canAct={canAct} onVote={actions.onVote} />;
    case "location":
      return <LocationView place={extra} />;
    case "contact":
      return <ContactsView contacts={extra.contacts} canAct={canAct} onOpenPhone={actions.onOpenPhone} />;
    case "event":
      return <EventView event={extra} />;
    case "invite":
      return <InviteView m={m} invite={extra} canAct={canAct} onAccept={actions.onAcceptInvite} />;
    case "call":
      return <CallView call={extra} text={m.text} />;
    default:
      return null;
  }
}

function PollView({ m, poll, canAct, onVote }: { m: Message; poll: Extract<Extra, { type: "poll" }>; canAct: boolean; onVote: RichActions["onVote"] }) {
  const results = m.poll ?? { options: poll.options.map((name) => ({ name, count: 0, mine: false, voters: [] as string[] })), voters: 0 };
  const single = poll.selectable === 1;
  const mine = results.options.filter((o) => o.mine).map((o) => o.name);
  const [showVoters, setShowVoters] = useState(false);
  const pick = (name: string) => {
    if (single) return onVote(m, mine.includes(name) ? [] : [name]);
    onVote(m, mine.includes(name) ? mine.filter((o) => o !== name) : [...mine, name]);
  };
  const most = Math.max(1, ...results.options.map((o) => o.count));
  return (
    <div className="rich rich--poll">
      <p className="rich__eyebrow">
        <ListChecks size={14} aria-hidden /> Enquete
      </p>
      <p className="rich__title">{poll.question}</p>
      <p className="rich__hint">{single ? "Escolha uma opção." : "Escolha uma ou mais opções."}</p>
      <ul className="poll" role="group" aria-label={`Opções da enquete ${poll.question}`}>
        {results.options.map((o) => (
          <li key={o.name}>
            <button
              type="button"
              className={`poll__option${o.mine ? " is-mine" : ""}`}
              role={single ? "radio" : "checkbox"}
              aria-checked={o.mine}
              disabled={!canAct}
              title={o.voters.length ? `Votaram: ${o.voters.join(", ")}` : "Nenhum voto"}
              onClick={() => pick(o.name)}
            >
              <span className={`poll__check${single ? " poll__check--radio" : ""}`} aria-hidden>
                {o.mine && <Check size={12} />}
              </span>
              <span className="poll__body">
                <span className="poll__row">
                  <span className="poll__name">{o.name}</span>
                  <span className="poll__count" aria-label={`${o.count} ${o.count === 1 ? "voto" : "votos"}`}>
                    {o.count}
                  </span>
                </span>
                <span className="poll__bar" aria-hidden>
                  <span className="poll__fill" style={{ transform: `scaleX(${o.count / most})` }} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {results.voters > 0 ? (
        <>
          <button type="button" className="rich__link-button" aria-expanded={showVoters} onClick={() => setShowVoters((v) => !v)}>
            {results.voters} {results.voters === 1 ? "pessoa votou" : "pessoas votaram"} · {showVoters ? "ocultar votos" : "ver votos"}
            <ChevronDown size={14} aria-hidden className={showVoters ? "is-open" : undefined} />
          </button>
          {showVoters && (
            <dl className="poll__voters">
              {results.options
                .filter((o) => o.voters.length)
                .map((o) => (
                  <div key={o.name}>
                    <dt>{o.name}</dt>
                    <dd>{o.voters.join(", ")}</dd>
                  </div>
                ))}
            </dl>
          )}
        </>
      ) : (
        <p className="rich__hint">Ninguém votou ainda.</p>
      )}
    </div>
  );
}

function LocationView({ place }: { place: Extract<Extra, { type: "location" }> }) {
  const coords = `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lng}`)}`;
  return (
    <div className="rich">
      <p className="rich__eyebrow">
        <MapPin size={14} aria-hidden /> {place.live ? "Localização em tempo real" : "Localização"}
      </p>
      {place.name && <p className="rich__title">{place.name}</p>}
      {place.address && <p className="rich__text">{place.address}</p>}
      <p className="rich__hint">{place.live ? `Posição de quando começou a compartilhar: ${coords}` : coords}</p>
      <a className="rich__action" href={map} target="_blank" rel="noreferrer">
        <ExternalLink size={14} aria-hidden /> Abrir no mapa
      </a>
    </div>
  );
}

function ContactsView({ contacts, canAct, onOpenPhone }: { contacts: ContactCard[]; canAct: boolean; onOpenPhone: (phone: string) => void }) {
  return (
    <ul className="rich rich--contacts" aria-label={contacts.length > 1 ? `${contacts.length} contatos` : "Contato"}>
      {contacts.map((c, i) => {
        const phone = c.phones[0];
        const digits = phone ? (phone.waid ?? phone.number.replace(/\D/g, "")) : null;
        return (
          <li key={`${c.name}-${i}`} className="contact-card">
            <span className="avatar avatar--sm" aria-hidden>
              {initials(c.name)}
            </span>
            <span className="contact-card__info">
              <span className="contact-card__name">{c.name}</span>
              {c.phones.length ? c.phones.map((p) => <span key={p.number} className="rich__hint">{formatPhone(p.number)}</span>) : <span className="rich__hint">Sem telefone</span>}
            </span>
            {digits && (
              <Button variant="secondary" size="compact" icon={<MessageCircle size={14} aria-hidden />} disabled={!canAct} onClick={() => onOpenPhone(digits)}>
                Conversar
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EventView({ event }: { event: Extract<Extra, { type: "event" }> }) {
  const when = event.start
    ? `${dateTime.format(event.start)}${event.end ? ` até ${new Date(event.end).toDateString() === new Date(event.start).toDateString() ? timeOnly.format(event.end) : dateTime.format(event.end)}` : ""}`
    : null;
  return (
    <div className="rich">
      <p className="rich__eyebrow">
        <CalendarDays size={14} aria-hidden /> Evento
        {event.canceled && <span className="badge badge--danger">Cancelado</span>}
      </p>
      <p className={`rich__title${event.canceled ? " is-canceled" : ""}`}>{event.name}</p>
      {when && <p className="rich__text">{when}</p>}
      {event.place && (
        <p className="rich__text">
          <MapPin size={12} aria-hidden /> {event.place}
        </p>
      )}
      {event.description && <p className="rich__hint rich__pre">{event.description}</p>}
      {event.link && (
        <a className="rich__action" href={event.link} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden /> Abrir link do evento
        </a>
      )}
    </div>
  );
}

function InviteView({ m, invite, canAct, onAccept }: { m: Message; invite: Extract<Extra, { type: "invite" }>; canAct: boolean; onAccept: (m: Message) => void }) {
  const [confirming, setConfirming] = useState(false);
  const expired = invite.expiration !== null && invite.expiration < Date.now();
  const name = invite.groupName ?? "grupo";
  return (
    <div className="rich">
      <p className="rich__eyebrow">
        <Users size={14} aria-hidden /> Convite de grupo
      </p>
      <p className="rich__title">{name}</p>
      {invite.caption && <p className="rich__text">{invite.caption}</p>}
      {m.fromMe ? (
        <p className="rich__hint">Convite enviado por você.</p>
      ) : expired ? (
        <p className="rich__hint">Convite vencido. Peça um novo a quem enviou.</p>
      ) : (
        <Button variant="secondary" size="compact" icon={<Users size={14} aria-hidden />} disabled={!canAct} onClick={() => setConfirming(true)}>
          Entrar no grupo
        </Button>
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Entrar no grupo “${name}”?`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false);
                onAccept(m);
              }}
            >
              Entrar no grupo
            </Button>
          </>
        }
      >
        Os participantes vão ver o seu número e você passa a receber as mensagens do grupo.
      </Dialog>
    </div>
  );
}

function CallView({ call, text }: { call: Extract<Extra, { type: "call" }>; text: string }) {
  const missed = call.outcome === "missed" && !call.outgoing;
  const Icon = call.outcome === "ringing" ? PhoneIncoming : missed ? PhoneMissed : call.outcome === "rejected" || call.outcome === "failed" ? PhoneOff : call.video ? Video : Phone;
  return (
    <p className={`call${missed ? " call--missed" : ""}`}>
      <span className="call__icon" aria-hidden>
        {call.outcome === "ringing" ? <LoaderCircle className="spin" size={16} /> : <Icon size={16} />}
      </span>
      <span>{text}</span>
    </p>
  );
}

/** Prévia de link (título, descrição e miniatura) acima do texto. */
export function LinkCard({ link }: { link: Extract<Extra, { type: "link" }> }) {
  let host = link.url;
  try {
    host = new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    // URL estranha: mostra como veio
  }
  return (
    <a className="link-card" href={link.url} target="_blank" rel="noreferrer">
      {link.thumb && <img className="link-card__thumb" src={`data:image/jpeg;base64,${link.thumb}`} alt="" />}
      <span className="link-card__body">
        {link.title && <span className="link-card__title">{link.title}</span>}
        {link.description && <span className="link-card__text">{link.description}</span>}
        <span className="link-card__host">{host}</span>
      </span>
    </a>
  );
}

/** Faixa no topo da conversa com a mensagem fixada; com várias, o clique alterna entre elas. */
export function PinnedBar({ chat, canAct, onJump, onUnpin }: { chat: Chat; canAct: boolean; onJump: (id: string) => void; onUnpin: (id: string) => void }) {
  const [index, setIndex] = useState(0);
  const pins = chat.pins.filter((p) => p.until > Date.now());
  if (!pins.length) return null;
  const current = pins[Math.min(index, pins.length - 1)];
  const text = current.text ? current.text.replace(/^\[[^\]]+\]\s*/, "") || current.text : "Mensagem fixada (não está salva neste computador)";
  return (
    <div className="pinned-bar" role="region" aria-label="Mensagens fixadas">
      <button
        type="button"
        className="pinned-bar__main"
        title={pins.length > 1 ? "Ir para a mensagem fixada (clique de novo para a próxima)" : "Ir para a mensagem fixada"}
        onClick={() => {
          onJump(current.id);
          if (pins.length > 1) setIndex((i) => (i + 1) % pins.length);
        }}
      >
        <Pin size={16} aria-hidden />
        <span className="pinned-bar__text">
          <span className="pinned-bar__label">{pins.length > 1 ? `Mensagem fixada ${Math.min(index, pins.length - 1) + 1} de ${pins.length}` : "Mensagem fixada"}</span>
          <span className="pinned-bar__preview">
            <WaInline text={text} />
          </span>
        </span>
      </button>
      <Button variant="ghost" size="compact" aria-label="Desafixar mensagem" title="Desafixar para todos" icon={<X size={16} aria-hidden />} disabled={!canAct} onClick={() => onUnpin(current.id)} />
    </div>
  );
}
