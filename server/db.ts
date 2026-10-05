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
};

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
create table if not exists settings (key text primary key, value text not null);
`;

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

  listChats(limit = 5000): Chat[] {
    return (this.db.prepare("select * from chats order by last_at desc limit ?").all(limit) as Row[]).map(toChat);
  }

  getChat(jid: string): Chat | null {
    const r = this.db.prepare("select * from chats where jid = ?").get(jid) as Row | undefined;
    return r ? toChat(r) : null;
  }

  /** Garante a conversa. Conversa criada pelo histórico nasce resolvida, salvo se tiver não lidas. */
  ensureChat(jid: string, initial: { status?: Status; unread?: number } = {}): void {
    this.db
      .prepare("insert or ignore into chats (jid, status, unread) values (?, ?, ?)")
      .run(jid, initial.status ?? "aberta", initial.unread ?? 0);
  }

  setNames(jid: string, names: { saved?: string | null; push?: string | null }): boolean {
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
      const lidChat = this.db.prepare("select * from chats where jid = ?").get(lid) as Row | undefined;
      if (!lidChat) return null;
      const pnChat = this.db.prepare("select * from chats where jid = ?").get(pn) as Row | undefined;
      if (!pnChat) {
        this.db.prepare("update chats set jid = ? where jid = ?").run(pn, lid);
        return this.getChat(pn);
      }
      this.db.prepare("update or ignore messages set chat_jid = ? where chat_jid = ?").run(pn, lid);
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
