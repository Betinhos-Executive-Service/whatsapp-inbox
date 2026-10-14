import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";

test("estado: registra, lê e limpa níveis por OS", () => {
  const s = new Store(":memory:");
  assert.equal(s.vigilanciaNivel("os-1"), null);
  s.vigilanciaRegistrar("os-1", "atencao", 1_000, 500);
  s.vigilanciaRegistrar("os-2", "atraso", 5_000, 500);
  assert.equal(s.vigilanciaNivel("os-1"), "atencao");
  s.vigilanciaRegistrar("os-1", "atraso", 1_000, 600);
  assert.equal(s.vigilanciaNivel("os-1"), "atraso");
  assert.equal(s.vigilanciaLimpar(2_000), 1);
  assert.equal(s.vigilanciaNivel("os-1"), null);
  assert.equal(s.vigilanciaNivel("os-2"), "atraso");
});

test("geocache: guarda coordenadas por endereço", () => {
  const s = new Store(":memory:");
  assert.equal(s.geocacheGet("Av. Paulista, 1000"), null);
  s.geocacheSet("Av. Paulista, 1000", { lat: -23.56, lon: -46.65 }, 1);
  assert.deepEqual(s.geocacheGet("Av. Paulista, 1000"), { lat: -23.56, lon: -46.65 });
});

test("ai_usage aceita o kind vigilancia, inclusive em banco antigo", () => {
  const s = new Store(":memory:");
  s.recordAiUsage({ at: 1, provider: "claude", kind: "vigilancia", chatJid: "g@g.us", model: "claude-opus-5-5", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 }, costUsd: 0.001, label: null, confidence: null, needsReply: null, urgent: null, ok: true });
  const n = s.db.prepare("select count(*) n from ai_usage where kind = 'vigilancia'").get() as { n: number };
  assert.equal(n.n, 1);
  // Banco antigo: tabela sem 'vigilancia' no check é recriada mantendo os dados.
  const velho = new Store(":memory:");
  velho.db.exec(`drop table ai_usage; create table ai_usage (
    id integer primary key, at integer not null,
    provider text not null check (provider in ('jev','deepseek','local','claude')),
    kind text not null check (kind in ('classificar','rascunho','resumo')),
    chat_jid text, model text not null, input_tokens integer not null default 0, output_tokens integer not null default 0,
    cached_tokens integer not null default 0, cost_usd real not null default 0, label text, confidence real, needs_reply real, urgent real, ok integer not null default 1);
    insert into ai_usage (at, provider, kind, model) values (1, 'jev', 'classificar', 'jev');`);
  // @ts-expect-error método privado exercitado de propósito
  velho.migrateUsageProviders();
  velho.recordAiUsage({ at: 2, provider: "claude", kind: "vigilancia", chatJid: null, model: "claude-opus-5-5", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, costUsd: 0, label: null, confidence: null, needsReply: null, urgent: null, ok: true });
  const total = velho.db.prepare("select count(*) n from ai_usage").get() as { n: number };
  assert.equal(total.n, 2);
});
