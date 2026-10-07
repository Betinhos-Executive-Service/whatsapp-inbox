import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Provider, TokenUsage, UsageKind } from "./pricing.ts";

export const STATUSES = ["aberta", "aguardando", "resolvida"] as const;
export type Status = (typeof STATUSES)[number];

export type Chat = {
  jid: string;
  name: string;
  phone: string | null;
  isGroup: boolean;
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
    /** Prioridade dada pela IA; motivo só quando a DeepSeek classificou. */
    priority: "alta" | "media" | "baixa" | null;
    reason: string | null;
    at: number;
  } | null;
  aiError: string | null;
  /** Nota interna, só neste computador. */
  note: string | null;
  /** Próximo lembrete pendente (ms) e se ele já venceu. */
  reminderAt: number | null;
  /** Tokens e custo estimado (US$) de toda a IA usada nesta conversa. */
  aiUsage: { calls: number; tokens: number; costUsd: number };
};

/** Uma chamada de IA (Jev, DeepSeek ou local) registrada para o painel de gastos. */
export type AiUsageRow = {
  at: number;
  provider: Provider;
  kind: UsageKind;
  chatJid: string | null;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  /** Etiqueta devolvida (só em classificação bem-sucedida). */
  label: string | null;
  confidence: number | null;
  needsReply: number | null;
  urgent: number | null;
  ok: boolean;
};

export type AiUsageSummary = {
  sinceAt: number | null;
  usdBrl: number;
  totals: { calls: number; failures: number; inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number };
  byKind: { kind: UsageKind; calls: number; tokens: number; costUsd: number }[];
  byProvider: { provider: Provider; calls: number; tokens: number; costUsd: number }[];
  /** Um ponto por dia (chave aaaa-mm-dd em America/Sao_Paulo), do mais antigo ao mais novo. */
  byDay: { day: string; calls: number; costUsd: number }[];
  classification: {
    total: number;
    failures: number;
    avgConfidence: number | null;
    needsReplyShare: number | null;
    urgentShare: number | null;
    byLabel: { label: string; count: number; avgConfidence: number }[];
  };
  topChats: { jid: string; name: string; calls: number; costUsd: number }[];
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
  /** Mídia baixável (sem as chaves, que ficam só no banco). */
  media: { type: string; mimetype: string; fileName: string | null; size: number | null } | null;
};

/** Correção sua de etiqueta, usada como exemplo nas próximas classificações do Jev. */
export type LabelExample = { label: string; snippet: string };

export type Label = { name: string; description: string };

export type IncomingMessage = Omit<Message, "media"> & { rawJid: string; participant?: string | null; media?: string | null };

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
create index if not exists reminders_chat on reminders(chat_jid, due_at) where done_at is null;
create table if not exists label_examples (
  id integer primary key,
  chat_jid text not null,
  label text not null,
  snippet text not null,
  created_at integer not null
);
create table if not exists ai_usage (
  id integer primary key,
  at integer not null,
  provider text not null check (provider in ('jev','deepseek','local','claude')),
  kind text not null check (kind in ('classificar','rascunho','resumo')),
  chat_jid text,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  cost_usd real not null default 0,
  label text,
  confidence real,
  needs_reply real,
  urgent real,
  ok integer not null default 1
);
create index if not exists ai_usage_at on ai_usage(at desc);
create index if not exists ai_usage_chat on ai_usage(chat_jid);
`;

/** Colunas acrescentadas depois da primeira versão; SQLite não tem "add column if not exists". */
const COLUMNS: [table: string, column: string, ddl: string][] = [
  ["chats", "note", "text"],
  ["messages", "participant", "text"],
  ["messages", "media", "text"],
  ["chats", "ai_priority", "text"],
  ["chats", "ai_reason", "text"],
];

const CHAT_SELECT = `select c.*,
  (select min(due_at) from reminders r where r.chat_jid = c.jid and r.done_at is null) as reminder_at,
  (select count(*) from ai_usage u where u.chat_jid = c.jid) as ai_calls,
  (select coalesce(sum(input_tokens + output_tokens), 0) from ai_usage u where u.chat_jid = c.jid) as ai_tokens,
  (select coalesce(sum(cost_usd), 0) from ai_usage u where u.chat_jid = c.jid) as ai_cost
  from chats c`;

type Row = Record<string, unknown>;

function phoneOf(jid: string): string | null {
  return jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] : null;
}

function toChat(r: Row): Chat {
  const jid = String(r.jid);
  const phone = phoneOf(jid);
  const isGroup = jid.endsWith("@g.us");
  return {
    jid,
    name: (r.saved_name as string) || (r.push_name as string) || (phone ? `+${phone}` : isGroup ? "Grupo sem nome" : "Contato sem número"),
    phone,
    isGroup,
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
            priority: r.ai_priority === "alta" || r.ai_priority === "media" || r.ai_priority === "baixa" ? r.ai_priority : null,
            reason: (r.ai_reason as string) || null,
            at: Number(r.ai_at),
          },
    aiError: (r.ai_error as string) ?? null,
    note: (r.note as string) || null,
    reminderAt: r.reminder_at == null ? null : Number(r.reminder_at),
    aiUsage: { calls: Number(r.ai_calls ?? 0), tokens: Number(r.ai_tokens ?? 0), costUsd: Number(r.ai_cost ?? 0) },
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
  let media: Message["media"] = null;
  if (typeof r.media === "string") {
    try {
      const m = JSON.parse(r.media);
      media = { type: m.type, mimetype: m.mimetype, fileName: m.fileName ?? null, size: m.size ?? null };
    } catch {
      media = null;
    }
  }
  return {
    chatJid: String(r.chat_jid),
    id: String(r.id),
    fromMe: r.from_me === 1,
    at: Number(r.at),
    text: String(r.text),
    kind: String(r.kind),
    media,
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
    this.migrateUsageProviders();
    const count = this.q("select count(*) n from labels").get() as Row;
    if (Number(count.n) === 0) this.saveLabels(DEFAULT_LABELS);
  }

  /** Bancos antigos têm o check de provider sem 'claude': recria a tabela mantendo os dados. */
  private migrateUsageProviders() {
    const row = this.db.prepare("select sql from sqlite_master where type = 'table' and name = 'ai_usage'").get() as Row | undefined;
    if (!row || String(row.sql).includes("'claude'")) return;
    this.db.exec(`begin;
      alter table ai_usage rename to ai_usage_old;
      ${SCHEMA.slice(SCHEMA.indexOf("create table if not exists ai_usage"), SCHEMA.indexOf("create index if not exists ai_usage_at"))}
      insert into ai_usage select * from ai_usage_old;
      drop table ai_usage_old;
      create index if not exists ai_usage_at on ai_usage(at desc);
      create index if not exists ai_usage_chat on ai_usage(chat_jid);
      commit;`);
  }

  /** Statements compilados uma vez e reaproveitados: o histórico grava milhares de mensagens. */
  private readonly stmts = new Map<string, StatementSync>();
  private q(sql: string): StatementSync {
    let stmt = this.stmts.get(sql);
    if (!stmt) this.stmts.set(sql, (stmt = this.db.prepare(sql)));
    return stmt;
  }

  /** Transação; chamada aninhada vira savepoint dentro da transação de fora. */
  private depth = 0;
  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    this.db.exec(this.depth ? `savepoint ${sp}` : "begin");
    this.depth++;
    try {
      const result = fn();
      this.db.exec(this.depth > 1 ? `release ${sp}` : "commit");
      return result;
    } catch (error) {
      this.db.exec(this.depth > 1 ? `rollback to ${sp}; release ${sp}` : "rollback");
      throw error;
    } finally {
      this.depth--;
    }
  }

  // ---- chats

  /** Conversa sem nenhuma mensagem salva não entra na lista: não há o que gerir nela. */
  listChats(limit = 5000): Chat[] {
    return (this.q(`${CHAT_SELECT} where c.last_at > 0 order by c.last_at desc limit ?`).all(limit) as Row[]).map(toChat);
  }

  hasChat(jid: string): boolean {
    return this.q("select 1 from chats where jid = ?").get(jid) !== undefined;
  }

  getChat(jid: string): Chat | null {
    const r = this.q(`${CHAT_SELECT} where c.jid = ?`).get(jid) as Row | undefined;
    return r ? toChat(r) : null;
  }

  /** Garante a conversa. Conversa criada pelo histórico nasce resolvida, salvo se tiver não lidas. */
  ensureChat(jid: string, initial: { status?: Status; unread?: number } = {}): void {
    this
      .q(
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
    // Só grava quando algo muda: no histórico o mesmo nome chega repetido a cada mensagem.
    const contact = this
      .q(
        `insert into contacts (jid, saved_name, push_name) values (?, ?, ?)
         on conflict(jid) do update set saved_name = coalesce(excluded.saved_name, saved_name),
                                        push_name = coalesce(excluded.push_name, push_name)
         where coalesce(excluded.saved_name, saved_name) is not saved_name
            or coalesce(excluded.push_name, push_name) is not push_name`,
      )
      .run(jid, names.saved || null, names.push || null);
    if (contact.changes === 0) return false;
    let changed = false;
    if (names.saved) {
      changed = this.q("update chats set saved_name = ? where jid = ? and saved_name is not ?").run(names.saved, jid, names.saved).changes > 0 || changed;
    }
    if (names.push) {
      changed = this.q("update chats set push_name = ? where jid = ? and push_name is not ?").run(names.push, jid, names.push).changes > 0 || changed;
    }
    return changed;
  }

  updateChat(jid: string, patch: { status?: Status; label?: string | null }): Chat | null {
    if (patch.status) this.q("update chats set status = ? where jid = ?").run(patch.status, jid);
    if (patch.label) this.recordLabelExample(jid, patch.label);
    if (patch.label !== undefined) {
      this
        .q("update chats set label = ?, label_source = ? where jid = ?")
        .run(patch.label, patch.label === null ? null : "manual", jid);
    }
    return this.getChat(jid);
  }

  markRead(jid: string): { id: string; rawJid: string; participant: string | null }[] {
    const chat = this.q("select unread from chats where jid = ?").get(jid) as Row | undefined;
    const unread = Number(chat?.unread ?? 0);
    if (!unread) return [];
    const keys = this
      .q("select id, raw_jid, participant from messages where chat_jid = ? and from_me = 0 order by at desc limit ?")
      .all(jid, unread) as Row[];
    this.q("update chats set unread = 0 where jid = ?").run(jid);
    return keys.map((k) => ({ id: String(k.id), rawJid: String(k.raw_jid), participant: (k.participant as string) ?? null }));
  }

  saveClassification(
    jid: string,
    result: { label: string; confidence: number; needsReply: number; urgent: number; priority?: "alta" | "media" | "baixa" | null; reason?: string | null },
  ): Chat | null {
    this
      .q(
        `update chats set ai_label = ?, ai_confidence = ?, ai_needs_reply = ?, ai_urgent = ?, ai_priority = ?, ai_reason = ?, ai_at = ?, ai_error = null,
           label = case when label_source = 'manual' then label else ? end,
           label_source = case when label_source = 'manual' then 'manual' else 'jev' end
         where jid = ?`,
      )
      .run(result.label, result.confidence, result.needsReply, result.urgent, result.priority ?? null, result.reason ?? null, Date.now(), result.label, jid);
    return this.getChat(jid);
  }

  saveClassificationError(jid: string, message: string): Chat | null {
    this.q("update chats set ai_error = ? where jid = ?").run(message, jid);
    return this.getChat(jid);
  }

  // ---- messages

  /**
   * Grava a mensagem e atualiza a conversa, sem ler nada de volta: é o caminho do lote do
   * histórico (milhares de mensagens). Devolve false se ela já existia.
   * `live` = mensagem nova (não histórico): mexe em não lidas e no status.
   */
  insertMessage(m: IncomingMessage, live: boolean): boolean {
    return this.tx(() => {
      this.ensureChat(m.chatJid, { status: live ? "aberta" : "resolvida" });
      const inserted = this
        .q("insert or ignore into messages (chat_jid, id, raw_jid, participant, from_me, at, text, kind, media) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(m.chatJid, m.id, m.rawJid, m.participant ?? null, m.fromMe ? 1 : 0, m.at, m.text, m.kind, m.media ?? null);
      if (inserted.changes === 0) return false;
      this
        .q("update chats set last_at = ?, last_text = ?, last_from_me = ? where jid = ? and last_at <= ?")
        .run(m.at, m.text, m.fromMe ? 1 : 0, m.chatJid, m.at);
      if (live && !m.fromMe) {
        this.q("update chats set unread = unread + 1, status = 'aberta' where jid = ?").run(m.chatJid);
      } else if (live && m.fromMe) {
        this
          .q("update chats set unread = 0, status = case when status = 'aberta' then 'aguardando' else status end where jid = ?")
          .run(m.chatJid);
      }
      return true;
    });
  }

  /** Grava a mensagem (ver insertMessage) e devolve mensagem e conversa já atualizadas, ou null se já existia. */
  addMessage(m: IncomingMessage, live: boolean): { message: Message; chat: Chat } | null {
    if (!this.insertMessage(m, live)) return null;
    const message = toMessage(this.q("select * from messages where chat_jid = ? and id = ?").get(m.chatJid, m.id) as Row);
    return { message, chat: this.getChat(m.chatJid)! };
  }

  listMessages(jid: string, before: number | null, limit = 80): Message[] {
    const rows = (before
      ? this.q("select * from messages where chat_jid = ? and at < ? order by at desc limit ?").all(jid, before, limit)
      : this.q("select * from messages where chat_jid = ? order by at desc limit ?").all(jid, limit)) as Row[];
    return rows.map(toMessage).reverse();
  }

  // ---- LID ↔ número

  /** Nome conhecido de um contato (agenda ou perfil), mesmo sem conversa aberta. */
  contactName(jid: string): string | null {
    const r = this.q("select saved_name, push_name from contacts where jid = ?").get(jid) as Row | undefined;
    return (r?.saved_name as string) || (r?.push_name as string) || null;
  }

  pnForLid(lid: string): string | null {
    const r = this.q("select pn from lid_map where lid = ?").get(lid) as Row | undefined;
    return r ? String(r.pn) : null;
  }

  /** Registra o par e funde a conversa que existia só pelo LID na conversa do número. */
  mapLid(lid: string, pn: string): Chat | null {
    return this.tx(() => {
      this.q("insert into lid_map (lid, pn) values (?, ?) on conflict(lid) do update set pn = excluded.pn").run(lid, pn);
      // Nome que chegou pelo LID passa a valer para o número.
      this
        .q(
          `insert into contacts (jid, saved_name, push_name) select ?, saved_name, push_name from contacts where jid = ? and true
           on conflict(jid) do update set saved_name = coalesce(contacts.saved_name, excluded.saved_name),
                                          push_name = coalesce(contacts.push_name, excluded.push_name)`,
        )
        .run(pn, lid);
      this
        .q(
          `update chats set saved_name = coalesce(saved_name, (select saved_name from contacts where jid = ?)),
                            push_name = coalesce(push_name, (select push_name from contacts where jid = ?))
           where jid = ?`,
        )
        .run(pn, pn, pn);
      const lidChat = this.q("select * from chats where jid = ?").get(lid) as Row | undefined;
      if (!lidChat) return null;
      const pnChat = this.q("select * from chats where jid = ?").get(pn) as Row | undefined;
      if (!pnChat) {
        this.q("update chats set jid = ? where jid = ?").run(pn, lid);
        this.q("update ai_usage set chat_jid = ? where chat_jid = ?").run(pn, lid);
        return this.getChat(pn);
      }
      this.q("update or ignore messages set chat_jid = ? where chat_jid = ?").run(pn, lid);
      this.q("update reminders set chat_jid = ? where chat_jid = ?").run(pn, lid);
      this.q("update ai_usage set chat_jid = ? where chat_jid = ?").run(pn, lid);
      this.q("update chats set note = coalesce(note, (select note from chats where jid = ?)) where jid = ?").run(lid, pn);
      this
        .q(
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
      this.q("delete from chats where jid = ?").run(lid);
      return this.getChat(pn);
    });
  }

  // ---- mídia

  /** Referência completa (com a chave) só para o download no servidor. */
  getMediaRef(jid: string, id: string): string | null {
    const r = this.q("select media from messages where chat_jid = ? and id = ?").get(jid, id) as Row | undefined;
    return typeof r?.media === "string" ? r.media : null;
  }

  // ---- aprendizado do Jev

  /**
   * Etiqueta escolhida à mão vira exemplo para o Jev: trecho das últimas mensagens de texto
   * do contato + a etiqueta certa. Guarda os 60 mais recentes, um por conversa.
   */
  recordLabelExample(jid: string, label: string): void {
    const texts = (this
      .q("select text from messages where chat_jid = ? and kind = 'text' order by at desc limit 8")
      .all(jid) as Row[]).map((r) => String(r.text)).reverse();
    const snippet = texts.join(" / ").slice(-600);
    if (!snippet) return;
    this.tx(() => {
      this.q("delete from label_examples where chat_jid = ?").run(jid);
      this.q("insert into label_examples (chat_jid, label, snippet, created_at) values (?, ?, ?, ?)").run(jid, label, snippet, Date.now());
      this.db.exec("delete from label_examples where id not in (select id from label_examples order by created_at desc limit 60)");
    });
  }

  /** Exemplos recentes de etiquetas que ainda existem, no máximo 2 por etiqueta. */
  labelExamples(excludeJid: string, limit = 10): LabelExample[] {
    const rows = this
      .q(
        `select label, snippet from label_examples
         where chat_jid <> ? and label in (select name from labels)
         order by created_at desc`,
      )
      .all(excludeJid) as Row[];
    const perLabel = new Map<string, number>();
    const out: LabelExample[] = [];
    for (const r of rows) {
      const label = String(r.label);
      if ((perLabel.get(label) ?? 0) >= 2) continue;
      perLabel.set(label, (perLabel.get(label) ?? 0) + 1);
      out.push({ label, snippet: String(r.snippet) });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ---- nota e lembretes

  setNote(jid: string, note: string | null): Chat | null {
    this.q("update chats set note = ? where jid = ?").run(note?.trim() ? note : null, jid);
    return this.getChat(jid);
  }

  listReminders(jid: string): Reminder[] {
    return (this.q("select * from reminders where chat_jid = ? and done_at is null order by due_at").all(jid) as Row[]).map(toReminder);
  }

  addReminder(jid: string, dueAt: number, text: string): Reminder {
    const r = this
      .q("insert into reminders (chat_jid, due_at, text, created_at) values (?, ?, ?, ?) returning *")
      .get(jid, dueAt, text.trim(), Date.now()) as Row;
    return toReminder(r);
  }

  /** Conclui ou apaga; devolve a conversa do lembrete para atualizar a tela. */
  finishReminder(id: number, mode: "done" | "delete"): string | null {
    const r = this.q("select chat_jid from reminders where id = ?").get(id) as Row | undefined;
    if (!r) return null;
    if (mode === "done") this.q("update reminders set done_at = ? where id = ?").run(Date.now(), id);
    else this.q("delete from reminders where id = ?").run(id);
    return String(r.chat_jid);
  }

  /**
   * Lembretes que venceram e ainda não avisaram: marca como avisados e reabre a conversa,
   * para ela voltar para "Abertas". Devolve cada um com a conversa atualizada.
   */
  fireDueReminders(now = Date.now()): { reminder: Reminder; chat: Chat }[] {
    return this.tx(() => {
      const due = (this
        .q("select * from reminders where done_at is null and fired_at is null and due_at <= ? order by due_at")
        .all(now) as Row[]).map(toReminder);
      for (const r of due) {
        this.q("update reminders set fired_at = ? where id = ?").run(now, r.id);
        this.q("update chats set status = 'aberta' where jid = ?").run(r.chatJid);
      }
      return due.map((r) => ({ reminder: { ...r, firedAt: now }, chat: this.getChat(r.chatJid)! }));
    });
  }

  // ---- respostas rápidas

  listQuickReplies(): QuickReply[] {
    return (this.q("select shortcut, text from quick_replies order by position").all() as Row[]).map((r) => ({
      shortcut: String(r.shortcut),
      text: String(r.text),
    }));
  }

  saveQuickReplies(list: QuickReply[]): QuickReply[] {
    this.tx(() => {
      this.db.exec("delete from quick_replies");
      const insert = this.q("insert into quick_replies (shortcut, text, position) values (?, ?, ?)");
      list.forEach((q, i) => insert.run(q.shortcut, q.text, i));
    });
    return this.listQuickReplies();
  }

  // ---- conta conectada

  /** Apaga conversas, mensagens e contatos deste computador. Etiquetas e configurações ficam. */
  clearConversations(): void {
    this.tx(() => {
      this.db.exec("delete from label_examples; delete from reminders; delete from messages; delete from chats; delete from contacts; delete from lid_map;");
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
    return (this.q("select name, description from labels order by position").all() as Row[]).map((r) => ({
      name: String(r.name),
      description: String(r.description),
    }));
  }

  saveLabels(labels: Label[]): Label[] {
    this.tx(() => {
      this.db.exec("delete from labels");
      const insert = this.q("insert into labels (name, description, position) values (?, ?, ?)");
      labels.forEach((l, i) => insert.run(l.name, l.description, i));
      // Etiqueta removida deixa de valer nas conversas.
      this
        .q(`update chats set label = null, label_source = null where label is not null and label not in (select name from labels)`)
        .run();
    });
    return this.listLabels();
  }

  // ---- gastos com IA

  recordAiUsage(row: AiUsageRow): void {
    this.q(
      `insert into ai_usage (at, provider, kind, chat_jid, model, input_tokens, output_tokens, cached_tokens, cost_usd, label, confidence, needs_reply, urgent, ok)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.at, row.provider, row.kind, row.chatJid, row.model,
      row.usage.inputTokens, row.usage.outputTokens, row.usage.cachedTokens, row.costUsd,
      row.label, row.confidence, row.needsReply, row.urgent, row.ok ? 1 : 0,
    );
  }

  /** Resumo para o painel de gastos. sinceAt = null: tudo. */
  aiUsageSummary(sinceAt: number | null, usdBrl: number): AiUsageSummary {
    const since = sinceAt ?? 0;
    const totals = this.q(
      `select count(*) calls, coalesce(sum(ok = 0), 0) failures, coalesce(sum(input_tokens), 0) input_tokens,
              coalesce(sum(output_tokens), 0) output_tokens, coalesce(sum(cached_tokens), 0) cached_tokens, coalesce(sum(cost_usd), 0) cost_usd
       from ai_usage where at >= ?`,
    ).get(since) as Row;
    const group = (col: "kind" | "provider") =>
      this.q(
        `select ${col} k, count(*) calls, coalesce(sum(input_tokens + output_tokens), 0) tokens, coalesce(sum(cost_usd), 0) cost_usd
         from ai_usage where at >= ? group by ${col} order by cost_usd desc, calls desc`,
      ).all(since) as Row[];
    // Dia em America/Sao_Paulo: o SQLite só conhece UTC, então o agrupamento por dia é feito aqui.
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
    const days = new Map<string, { calls: number; costUsd: number }>();
    for (const r of this.q("select at, cost_usd from ai_usage where at >= ? order by at").all(since) as Row[]) {
      const key = dayKey.format(Number(r.at));
      const d = days.get(key) ?? { calls: 0, costUsd: 0 };
      d.calls++;
      d.costUsd += Number(r.cost_usd);
      days.set(key, d);
    }
    const cls = this.q(
      `select count(*) total, coalesce(sum(ok = 0), 0) failures, avg(case when ok = 1 then confidence end) avg_confidence,
              avg(case when ok = 1 then needs_reply end) needs_reply, avg(case when ok = 1 then urgent end) urgent
       from ai_usage where kind = 'classificar' and at >= ?`,
    ).get(since) as Row;
    const byLabel = this.q(
      `select label, count(*) count, avg(confidence) avg_confidence from ai_usage
       where kind = 'classificar' and ok = 1 and label is not null and at >= ? group by label order by count desc, label`,
    ).all(since) as Row[];
    const topChats = this.q(
      `select u.chat_jid jid, c.saved_name, c.push_name, count(*) calls, coalesce(sum(u.cost_usd), 0) cost_usd
       from ai_usage u left join chats c on c.jid = u.chat_jid
       where u.chat_jid is not null and u.at >= ? group by u.chat_jid order by cost_usd desc, calls desc limit 5`,
    ).all(since) as Row[];
    const n = (v: unknown) => (v == null ? null : Number(v));
    return {
      sinceAt,
      usdBrl,
      totals: {
        calls: Number(totals.calls), failures: Number(totals.failures), inputTokens: Number(totals.input_tokens),
        outputTokens: Number(totals.output_tokens), cachedTokens: Number(totals.cached_tokens), costUsd: Number(totals.cost_usd),
      },
      byKind: group("kind").map((r) => ({ kind: r.k as UsageKind, calls: Number(r.calls), tokens: Number(r.tokens), costUsd: Number(r.cost_usd) })),
      byProvider: group("provider").map((r) => ({ provider: r.k as Provider, calls: Number(r.calls), tokens: Number(r.tokens), costUsd: Number(r.cost_usd) })),
      byDay: [...days].map(([day, d]) => ({ day, ...d })),
      classification: {
        total: Number(cls.total),
        failures: Number(cls.failures),
        avgConfidence: n(cls.avg_confidence),
        needsReplyShare: n(cls.needs_reply),
        urgentShare: n(cls.urgent),
        byLabel: byLabel.map((r) => ({ label: String(r.label), count: Number(r.count), avgConfidence: Number(r.avg_confidence) })),
      },
      topChats: topChats.map((r) => {
        const jid = String(r.jid);
        const phone = phoneOf(jid);
        return {
          jid,
          name: (r.saved_name as string) || (r.push_name as string) || (phone ? `+${phone}` : "Conversa apagada"),
          calls: Number(r.calls),
          costUsd: Number(r.cost_usd),
        };
      }),
    };
  }

  getSetting(key: string): string | null {
    const r = this.q("select value from settings where key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.q("delete from settings where key = ?").run(key);
    else this.q("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }
}
