import { DatabaseSync } from "node:sqlite";

export const STATUSES = ["aberta", "aguardando", "resolvida"] as const;
export type Status = (typeof STATUSES)[number];

export type Chat = {
  jid: string;
  name: string;
  phone: string | null;
  lastAt: number;
  lastText: string | null;
  lastFromMe: boolean;
  unread: number;
  status: Status;
  label: string | null;
  labelSource: "manual" | "jev" | null;
  ai: {
    label: string;
    confidence: number;
    needsReply: number;
    urgent: number;
    at: number;
  } | null;
  aiError: string | null;
  /** Nota interna, só neste computador. */
  note: string | null;
  /** Próximo lembrete pendente (ms) e se ele já venceu. */
  reminderAt: number | null;
};

export type Reminder = { id: number; chatJid: string; dueAt: number; text: string; firedAt: number | null };
export type QuickReply = { shortcut: string; text: string };

export type Message = {
  chatJid: string;
  id: string;
  fromMe: boolean;
  at: number;
  text: string;
  kind: string;
};

export type Label = { name: string; description: string };

export type IncomingMessage = Message & { rawJid: string };

const DEFAULT_LABELS: Label[] = [
  { name: "Cotação", description: "Pedido de preço, orçamento ou proposta de serviço." },
  { name: "Reserva", description: "Agendamento, confirmação ou alteração de um serviço." },
  { name: "Operação", description: "Serviço em andamento: motorista, horário, local, atraso." },
  { name: "Financeiro", description: "Pagamento, cobrança, nota fiscal ou comprovante." },
  { name: "Pessoal", description: "Assunto pessoal, sem relação com trabalho." },
  { name: "Outros", description: "Assunto claramente fora das demais etiquetas." },
];

const SCHEMA = `
pragma journal_mode = wal;
pragma synchronous = normal;
pragma foreign_keys = on;
create table if not exists chats (
  jid text primary key,
  saved_name text,
  push_name text,
  last_at integer not null default 0,
  last_text text,
  last_from_me integer not null default 0,
  unread integer not null default 0,
  status text not null default 'aberta' check (status in ('aberta','aguardando','resolvida')),
  label text,
  label_source text check (label_source in ('manual','jev')),
  ai_label text,
  ai_confidence real,
  ai_needs_reply real,
  ai_urgent real,
  ai_at integer,
  ai_error text
);
create index if not exists chats_last_at on chats(last_at desc);
create table if not exists messages (
  chat_jid text not null references chats(jid) on delete cascade on update cascade,
  id text not null,
  raw_jid text not null,
  from_me integer not null,
  at integer not null,
  text text not null,
  kind text not null,
  primary key (chat_jid, id)
);
create index if not exists messages_chat_at on messages(chat_jid, at desc);
create table if not exists labels (
  name text primary key,
  description text not null default '',
  position integer not null
);
create table if not exists lid_map (lid text primary key, pn text not null);
create table if not exists contacts (jid text primary key, saved_name text, push_name text);
create table if not exists settings (key text primary key, value text not null);
create table if not exists quick_replies (
  shortcut text primary key,
  text text not null,
  position integer not null
);
create table if not exists reminders (
  id integer primary key,
  chat_jid text not null references chats(jid) on delete cascade on update cascade,
  due_at integer not null,
  text text not null default '',
  created_at integer not null,
  fired_at integer,
  done_at integer
);
create index if not exists reminders_pending on reminders(due_at) where done_at is null;
`;

/** Colunas acrescentadas depois da primeira versão; SQLite não tem "add column if not exists". */
const COLUMNS: [table: string, column: string, ddl: string][] = [["chats", "note", "text"]];

const CHAT_SELECT = `select c.*, (select min(due_at) from reminders r where r.chat_jid = c.jid and r.done_at is null) as reminder_at from chats c`;

type Row = Record<string, unknown>;

function phoneOf(jid: string): string | null {
  return jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] : null;
}

function toChat(r: Row): Chat {
  const jid = String(r.jid);
  const phone = phoneOf(jid);
  return {
    jid,
    name: (r.saved_name as string) || (r.push_name as string) || (phone ? `+${phone}` : "Contato sem número"),
    phone,
    lastAt: Number(r.last_at),
    lastText: (r.last_text as string) ?? null,
    lastFromMe: r.last_from_me === 1,
    unread: Number(r.unread),
    status: r.status as Status,
    label: (r.label as string) ?? null,
    labelSource: (r.label_source as Chat["labelSource"]) ?? null,
    ai:
      r.ai_label == null
        ? null
        : {
            label: String(r.ai_label),
            confidence: Number(r.ai_confidence),
            needsReply: Number(r.ai_needs_reply),
            urgent: Number(r.ai_urgent),
            at: Number(r.ai_at),
          },
    aiError: (r.ai_error as string) ?? null,
    note: (r.note as string) || null,
    reminderAt: r.reminder_at == null ? null : Number(r.reminder_at),
  };
}

function toReminder(r: Row): Reminder {
  return {
    id: Number(r.id),
    chatJid: String(r.chat_jid),
    dueAt: Number(r.due_at),
    text: String(r.text),
    firedAt: r.fired_at == null ? null : Number(r.fired_at),
  };
}

function toMessage(r: Row): Message {
  return {
    chatJid: String(r.chat_jid),
    id: String(r.id),
    fromMe: r.from_me === 1,
    at: Number(r.at),
    text: String(r.text),
    kind: String(r.kind),
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    for (const [table, column, ddl] of COLUMNS) {
      const cols = this.db.prepare(`pragma table_info(${table})`).all() as Row[];
      if (!cols.some((c) => c.name === column)) this.db.exec(`alter table ${table} add column ${column} ${ddl}`);
    }
    const count = this.db.prepare("select count(*) n from labels").get() as Row;
    if (Number(count.n) === 0) this.saveLabels(DEFAULT_LABELS);
  }

  tx<T>(fn: () => T): T {
    this.db.exec("begin");
    try {
      const result = fn();
      this.db.exec("commit");
      return result;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  // ---- chats

  /** Conversa sem nenhuma mensagem salva não entra na lista: não há o que gerir nela. */
  listChats(limit = 5000): Chat[] {
    return (this.db.prepare(`${CHAT_SELECT} where c.last_at > 0 order by c.last_at desc limit ?`).all(limit) as Row[]).map(toChat);
  }

  getChat(jid: string): Chat | null {
    const r = this.db.prepare(`${CHAT_SELECT} where c.jid = ?`).get(jid) as Row | undefined;
    return r ? toChat(r) : null;
  }

  /** Garante a conversa. Conversa criada pelo histórico nasce resolvida, salvo se tiver não lidas. */
  ensureChat(jid: string, initial: { status?: Status; unread?: number } = {}): void {
    this.db
      .prepare(
        `insert or ignore into chats (jid, status, unread, saved_name, push_name) values (?, ?, ?,
           (select saved_name from contacts where jid = ?), (select push_name from contacts where jid = ?))`,
      )
      .run(jid, initial.status ?? "aberta", initial.unread ?? 0, jid, jid);
  }

  /**
   * Guarda o nome do contato mesmo sem conversa: o WhatsApp manda a agenda antes das
   * conversas, e a conversa criada depois herda o nome. Devolve true se a conversa mudou.
   */
  setNames(jid: string, names: { saved?: string | null; push?: string | null }): boolean {
    if (!names.saved && !names.push) return false;
    this.db
      .prepare(
        `insert into contacts (jid, saved_name, push_name) values (?, ?, ?)
         on conflict(jid) do update set saved_name = coalesce(excluded.saved_name, saved_name),
                                        push_name = coalesce(excluded.push_name, push_name)`,
      )
      .run(jid, names.saved || null, names.push || null);
    let changed = false;
    if (names.saved) {
      changed = this.db.prepare("update chats set saved_name = ? where jid = ? and saved_name is not ?").run(names.saved, jid, names.saved).changes > 0 || changed;
    }
    if (names.push) {
      changed = this.db.prepare("update chats set push_name = ? where jid = ? and push_name is not ?").run(names.push, jid, names.push).changes > 0 || changed;
    }
    return changed;
  }

  updateChat(jid: string, patch: { status?: Status; label?: string | null }): Chat | null {
    if (patch.status) this.db.prepare("update chats set status = ? where jid = ?").run(patch.status, jid);
    if (patch.label !== undefined) {
      this.db
        .prepare("update chats set label = ?, label_source = ? where jid = ?")
        .run(patch.label, patch.label === null ? null : "manual", jid);
    }
    return this.getChat(jid);
  }

  markRead(jid: string): { id: string; rawJid: string }[] {
    const chat = this.db.prepare("select unread from chats where jid = ?").get(jid) as Row | undefined;
    const unread = Number(chat?.unread ?? 0);
    if (!unread) return [];
    const keys = this.db
      .prepare("select id, raw_jid from messages where chat_jid = ? and from_me = 0 order by at desc limit ?")
      .all(jid, unread) as Row[];
    this.db.prepare("update chats set unread = 0 where jid = ?").run(jid);
    return keys.map((k) => ({ id: String(k.id), rawJid: String(k.raw_jid) }));
  }

  saveClassification(
    jid: string,
    result: { label: string; confidence: number; needsReply: number; urgent: number },
  ): Chat | null {
    this.db
      .prepare(
        `update chats set ai_label = ?, ai_confidence = ?, ai_needs_reply = ?, ai_urgent = ?, ai_at = ?, ai_error = null,
           label = case when label_source = 'manual' then label else ? end,
           label_source = case when label_source = 'manual' then 'manual' else 'jev' end
         where jid = ?`,
      )
      .run(result.label, result.confidence, result.needsReply, result.urgent, Date.now(), result.label, jid);
    return this.getChat(jid);
  }

  saveClassificationError(jid: string, message: string): Chat | null {
    this.db.prepare("update chats set ai_error = ? where jid = ?").run(message, jid);
    return this.getChat(jid);
  }

  // ---- messages

  /**
   * Grava a mensagem e atualiza a conversa. Devolve null se ela já existia.
   * `live` = mensagem nova (não histórico): mexe em não lidas e no status.
   */
  addMessage(m: IncomingMessage, live: boolean): { message: Message; chat: Chat } | null {
    return this.tx(() => {
      this.ensureChat(m.chatJid, { status: live ? "aberta" : "resolvida" });
      const inserted = this.db
        .prepare("insert or ignore into messages (chat_jid, id, raw_jid, from_me, at, text, kind) values (?, ?, ?, ?, ?, ?, ?)")
        .run(m.chatJid, m.id, m.rawJid, m.fromMe ? 1 : 0, m.at, m.text, m.kind);
      if (inserted.changes === 0) return null;
      this.db
        .prepare(
          "update chats set last_at = ?, last_text = ?, last_from_me = ? where jid = ? and last_at <= ?",
        )
        .run(m.at, m.text, m.fromMe ? 1 : 0, m.chatJid, m.at);
      if (live && !m.fromMe) {
        this.db.prepare("update chats set unread = unread + 1, status = 'aberta' where jid = ?").run(m.chatJid);
      } else if (live && m.fromMe) {
        this.db
          .prepare("update chats set unread = 0, status = case when status = 'aberta' then 'aguardando' else status end where jid = ?")
          .run(m.chatJid);
      }
      return { message: { chatJid: m.chatJid, id: m.id, fromMe: m.fromMe, at: m.at, text: m.text, kind: m.kind }, chat: this.getChat(m.chatJid)! };
    });
  }

  listMessages(jid: string, before: number | null, limit = 80): Message[] {
    const rows = (before
      ? this.db.prepare("select * from messages where chat_jid = ? and at < ? order by at desc limit ?").all(jid, before, limit)
      : this.db.prepare("select * from messages where chat_jid = ? order by at desc limit ?").all(jid, limit)) as Row[];
    return rows.map(toMessage).reverse();
  }

  // ---- LID ↔ número

  pnForLid(lid: string): string | null {
    const r = this.db.prepare("select pn from lid_map where lid = ?").get(lid) as Row | undefined;
    return r ? String(r.pn) : null;
  }

  /** Registra o par e funde a conversa que existia só pelo LID na conversa do número. */
  mapLid(lid: string, pn: string): Chat | null {
    return this.tx(() => {
      this.db.prepare("insert into lid_map (lid, pn) values (?, ?) on conflict(lid) do update set pn = excluded.pn").run(lid, pn);
      // Nome que chegou pelo LID passa a valer para o número.
      this.db
        .prepare(
          `insert into contacts (jid, saved_name, push_name) select ?, saved_name, push_name from contacts where jid = ? and true
           on conflict(jid) do update set saved_name = coalesce(contacts.saved_name, excluded.saved_name),
                                          push_name = coalesce(contacts.push_name, excluded.push_name)`,
        )
        .run(pn, lid);
      this.db
        .prepare(
          `update chats set saved_name = coalesce(saved_name, (select saved_name from contacts where jid = ?)),
                            push_name = coalesce(push_name, (select push_name from contacts where jid = ?))
           where jid = ?`,
        )
        .run(pn, pn, pn);
      const lidChat = this.db.prepare("select * from chats where jid = ?").get(lid) as Row | undefined;
      if (!lidChat) return null;
      const pnChat = this.db.prepare("select * from chats where jid = ?").get(pn) as Row | undefined;
      if (!pnChat) {
        this.db.prepare("update chats set jid = ? where jid = ?").run(pn, lid);
        return this.getChat(pn);
      }
      this.db.prepare("update or ignore messages set chat_jid = ? where chat_jid = ?").run(pn, lid);
      this.db.prepare("update reminders set chat_jid = ? where chat_jid = ?").run(pn, lid);
      this.db.prepare("update chats set note = coalesce(note, (select note from chats where jid = ?)) where jid = ?").run(lid, pn);
      this.db
        .prepare(
          `update chats set
             unread = unread + ?,
             saved_name = coalesce(saved_name, ?),
             push_name = coalesce(push_name, ?),
             last_at = max(last_at, ?),
             last_text = case when ? > last_at then ? else last_text end,
             last_from_me = case when ? > last_at then ? else last_from_me end
           where jid = ?`,
        )
        .run(
          Number(lidChat.unread), lidChat.saved_name as string | null, lidChat.push_name as string | null,
          Number(lidChat.last_at), Number(lidChat.last_at), lidChat.last_text as string | null,
          Number(lidChat.last_at), Number(lidChat.last_from_me), pn,
        );
      this.db.prepare("delete from chats where jid = ?").run(lid);
      return this.getChat(pn);
    });
  }

  // ---- nota e lembretes

  setNote(jid: string, note: string | null): Chat | null {
    this.db.prepare("update chats set note = ? where jid = ?").run(note?.trim() ? note : null, jid);
    return this.getChat(jid);
  }

  listReminders(jid: string): Reminder[] {
    return (this.db.prepare("select * from reminders where chat_jid = ? and done_at is null order by due_at").all(jid) as Row[]).map(toReminder);
  }

  addReminder(jid: string, dueAt: number, text: string): Reminder {
    const r = this.db
      .prepare("insert into reminders (chat_jid, due_at, text, created_at) values (?, ?, ?, ?) returning *")
      .get(jid, dueAt, text.trim(), Date.now()) as Row;
    return toReminder(r);
  }

  /** Conclui ou apaga; devolve a conversa do lembrete para atualizar a tela. */
  finishReminder(id: number, mode: "done" | "delete"): string | null {
    const r = this.db.prepare("select chat_jid from reminders where id = ?").get(id) as Row | undefined;
    if (!r) return null;
    if (mode === "done") this.db.prepare("update reminders set done_at = ? where id = ?").run(Date.now(), id);
    else this.db.prepare("delete from reminders where id = ?").run(id);
    return String(r.chat_jid);
  }

  /**
   * Lembretes que venceram e ainda não avisaram: marca como avisados e reabre a conversa,
   * para ela voltar para "Abertas". Devolve cada um com a conversa atualizada.
   */
  fireDueReminders(now = Date.now()): { reminder: Reminder; chat: Chat }[] {
    return this.tx(() => {
      const due = (this.db
        .prepare("select * from reminders where done_at is null and fired_at is null and due_at <= ? order by due_at")
        .all(now) as Row[]).map(toReminder);
      for (const r of due) {
        this.db.prepare("update reminders set fired_at = ? where id = ?").run(now, r.id);
        this.db.prepare("update chats set status = 'aberta' where jid = ?").run(r.chatJid);
      }
      return due.map((r) => ({ reminder: { ...r, firedAt: now }, chat: this.getChat(r.chatJid)! }));
    });
  }

  // ---- respostas rápidas

  listQuickReplies(): QuickReply[] {
    return (this.db.prepare("select shortcut, text from quick_replies order by position").all() as Row[]).map((r) => ({
      shortcut: String(r.shortcut),
      text: String(r.text),
    }));
  }

  saveQuickReplies(list: QuickReply[]): QuickReply[] {
    this.tx(() => {
      this.db.exec("delete from quick_replies");
      const insert = this.db.prepare("insert into quick_replies (shortcut, text, position) values (?, ?, ?)");
      list.forEach((q, i) => insert.run(q.shortcut, q.text, i));
    });
    return this.listQuickReplies();
  }

  // ---- conta conectada

  /** Apaga conversas, mensagens e contatos deste computador. Etiquetas e configurações ficam. */
  clearConversations(): void {
    this.tx(() => {
      this.db.exec("delete from reminders; delete from messages; delete from chats; delete from contacts; delete from lid_map;");
      // A agenda precisa ser pedida de novo na próxima conexão.
      this.setSetting("contacts_backfill", null);
    });
  }

  /**
   * Chamado quando o WhatsApp conecta. Se o número for outro, as conversas do número
   * anterior saem antes de chegar o histórico do novo. Devolve true se apagou.
   */
  switchAccount(number: string): boolean {
    const previous = this.getSetting("account");
    if (previous === number) return false;
    if (previous) this.clearConversations();
    this.setSetting("account", number);
    return previous !== null;
  }

  // ---- etiquetas e configurações

  listLabels(): Label[] {
    return (this.db.prepare("select name, description from labels order by position").all() as Row[]).map((r) => ({
      name: String(r.name),
      description: String(r.description),
    }));
  }

  saveLabels(labels: Label[]): Label[] {
    this.tx(() => {
      this.db.exec("delete from labels");
      const insert = this.db.prepare("insert into labels (name, description, position) values (?, ?, ?)");
      labels.forEach((l, i) => insert.run(l.name, l.description, i));
      // Etiqueta removida deixa de valer nas conversas.
      this.db
        .prepare(`update chats set label = null, label_source = null where label is not null and label not in (select name from labels)`)
        .run();
    });
    return this.listLabels();
  }

  getSetting(key: string): string | null {
    const r = this.db.prepare("select value from settings where key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.db.prepare("delete from settings where key = ?").run(key);
    else this.db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }
}
