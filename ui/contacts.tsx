import { Copy, MessageSquareText, UserRound } from "lucide-react";
import { api, type Chat, type ContactCard } from "./api.ts";
import { initials } from "./format.ts";
import { ChatPicker } from "./forward.tsx";

/** Número só com dígitos para abrir conversa: o waid do WhatsApp ou o telefone do cartão. */
export function contactDigits(c: ContactCard): string | null {
  const p = c.phones[0];
  if (!p) return null;
  const digits = (p.wa ?? p.number).replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** Cartão de contato na bolha, como no WhatsApp: nome, número e "Conversar". */
export function ContactCards({ contacts, onOpen, onCopy }: {
  contacts: ContactCard[];
  onOpen: (digits: string) => void;
  onCopy: (text: string) => void;
}) {
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
