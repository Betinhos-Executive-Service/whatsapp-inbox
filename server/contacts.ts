import type { Contact, Store } from "./db.ts";

/** Cartão de contato (vCard) enviado ou recebido no WhatsApp. */
export type ContactCard = { name: string; phones: { number: string; wa: string | null }[] };

const unescape = (v: string) => v.replace(/\\([,;\\nN])/g, (_, c) => (c === "n" || c === "N" ? " " : c)).trim();

/** Lê nome e telefones do vCard. `waid` = número com WhatsApp (só dígitos). */
export function parseVcard(vcard: string, fallbackName = ""): ContactCard {
  // Linhas dobradas (começam com espaço) continuam a anterior.
  const lines = vcard.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  let name = "";
  let structured = "";
  const phones: ContactCard["phones"] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const key = head.split(";")[0].replace(/^item\d+\./i, "").toUpperCase();
    if (key === "FN") name = unescape(value);
    else if (key === "N") structured = value.split(";").filter(Boolean).reverse().map(unescape).join(" ");
    else if (key === "TEL") {
      const wa = /waid=(\d+)/i.exec(head)?.[1] ?? null;
      const number = value.trim();
      if (number) phones.push({ number, wa });
    }
  }
  return { name: name || structured || fallbackName || phones[0]?.number || "Contato", phones };
}

const escape = (v: string) => v.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, " ");

/** vCard 3.0 no formato que o WhatsApp reconhece (waid liga o botão "Conversar"). */
export function buildVcard(name: string, phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return ["BEGIN:VCARD", "VERSION:3.0", `FN:${escape(name)}`, `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`, "END:VCARD"].join("\n");
}

type Content = Record<string, any> | null | undefined;

/** Contatos da mensagem (um ou vários); null se não for mensagem de contato. */
export function extractContacts(content: Content): ContactCard[] | null {
  if (!content) return null;
  const one = content.contactMessage;
  if (one?.vcard) return [parseVcard(String(one.vcard), one.displayName ?? "")];
  const many = content.contactsArrayMessage?.contacts;
  if (Array.isArray(many)) {
    const list = many.filter((c) => c?.vcard).map((c) => parseVcard(String(c.vcard), c.displayName ?? ""));
    return list.length ? list : null;
  }
  return null;
}

type SaveDeps = {
  /** JID do número no WhatsApp; null se não tiver conta. */
  resolve: (digits: string) => Promise<string | null>;
  sync: (jid: string, fullName: string, firstName: string) => Promise<void>;
  store: Pick<Store, "setNames">;
};

/** WhatsApp primeiro: se a conta recusar, nada muda aqui e o Inbox não mostra nome que a conta não tem. */
export async function saveContact(deps: SaveDeps, input: { digits: string; firstName: string; lastName?: string }): Promise<Contact> {
  const firstName = input.firstName.trim();
  const fullName = [firstName, input.lastName?.trim()].filter(Boolean).join(" ");
  const jid = await deps.resolve(input.digits);
  if (!jid) throw new Error("Este número não tem WhatsApp.");
  await deps.sync(jid, fullName, firstName);
  deps.store.setNames(jid, { saved: fullName });
  return { jid, name: fullName, phone: jid.split("@")[0] };
}
