import { useEffect, useSyncExternalStore } from "react";
import { api, type Contact } from "./api.ts";
import { normalize } from "./format.ts";

/** Nome é a primeira palavra; o resto é sobrenome. O WhatsApp guarda o nome completo. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

export type ContactSection = { letter: string; contacts: Contact[] };

/** Filtra por nome ou dígitos e agrupa por inicial; o que não começa com letra vai para "#". */
export function contactSections(list: Contact[], query: string): ContactSection[] {
  const q = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  const hits = list.filter((c) => !q || normalize(c.name).includes(q) || (digits.length > 0 && c.phone.includes(digits)));
  const sections = new Map<string, Contact[]>();
  for (const c of hits) {
    const first = normalize(c.name).charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    sections.set(letter, [...(sections.get(letter) ?? []), c]);
  }
  return [...sections].map(([letter, contacts]) => ({ letter, contacts })).sort((a, b) => a.letter.localeCompare(b.letter, "pt-BR"));
}

type State = { contacts: Contact[] | null; error: string | null; recent: string | null };
let state: State = { contacts: null, error: null, recent: null };
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};
const byName = (a: Contact, b: Contact) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });

export async function refreshContacts(): Promise<Contact[]> {
  try {
    const contacts = await api.contacts();
    set({ ...state, contacts, error: null });
    return contacts;
  } catch (e) {
    set({ ...state, error: (e as Error).message });
    throw e;
  }
}

/** Atualiza a lista sem esperar o servidor e marca a linha para o realce. */
export function markSaved(contact: Contact) {
  set({ ...state, recent: contact.jid, contacts: [...(state.contacts ?? []).filter((c) => c.jid !== contact.jid), contact].sort(byName) });
}

export function markDeleted(jid: string) {
  set({ ...state, recent: null, contacts: (state.contacts ?? []).filter((c) => c.jid !== jid) });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Agenda compartilhada por painel, perfil e cartões; carrega na primeira tela que precisar. */
export function useContacts(): State {
  const value = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (state.contacts === null) void refreshContacts().catch(() => undefined);
  }, []);
  return value;
}
