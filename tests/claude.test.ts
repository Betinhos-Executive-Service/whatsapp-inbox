import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store, type Message } from "../server/db.ts";
import { ClaudePlanAI, CLAUDE_ALLOWED_TOOLS, type ClaudeRun } from "../server/claude.ts";

const msg = (fromMe: boolean, text: string, at: number): Message => ({ chatJid: "x", id: String(at), fromMe, at, text, kind: "text", media: null, quoted: null, deleted: false, sender: null, ack: null, editedAt: null, reactions: [] });
const conversa = [msg(false, "Bom dia! Preciso de carro amanhã às 7h para Guarulhos. Qual o valor?", 1_760_000_000_000)];

function fakeRun(result: unknown, seen: { args?: string[]; input?: string; cwd?: string } = {}): ClaudeRun {
  return async (_bin, args, input, cwd) => {
    Object.assign(seen, { args, input, cwd });
    return JSON.stringify(result);
  };
}

test("Claude (plano): rascunho vai pela entrada padrão, com modelo, ferramentas só de leitura e trava de preço", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-claude-"));
  try {
    const seen: { args?: string[]; input?: string; cwd?: string } = {};
    const ai = new ClaudePlanAI(dir, () => "haiku", () => "claude.exe", fakeRun({
      is_error: false,
      result: '"Bom dia! O valor é R$ 300,00. Saímos às 7h."',
      usage: { input_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, output_tokens: 20 },
    }, seen));
    const { text, usage } = await ai.draft("Ana", conversa, "");
    assert.equal(seen.cwd, dir);
    assert.match(seen.input ?? "", /Guarulhos/);
    assert.ok(!seen.args?.some((a) => a.includes("Guarulhos")), "conversa nunca na linha de comando");
    assert.equal(seen.args?.[seen.args.indexOf("--model") + 1], "haiku");
    assert.equal(seen.args?.[seen.args.indexOf("--allowedTools") + 1], CLAUDE_ALLOWED_TOOLS.join(","));
    assert.ok(CLAUDE_ALLOWED_TOOLS.every((t) => /read_query|search|describe/.test(t)));
    assert.deepEqual(usage, { inputTokens: 610, outputTokens: 20, cachedTokens: 600 });
    assert.ok(!text.includes("300"));
    assert.ok(!text.startsWith('"'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude (plano): resumo, erro do CLI e Claude Code ausente", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-claude-"));
  try {
    const ok = new ClaudePlanAI(dir, undefined, () => "claude", fakeRun({ result: "RESUMO: Ana quer carro.\nPEDIDO: valor\nPRÓXIMO PASSO: cotar" }));
    assert.deepEqual((await ok.summarize("Ana", conversa)).summary, { resumo: "Ana quer carro.", pedido: "valor", proximoPasso: "cotar" });
    const failed = new ClaudePlanAI(dir, undefined, () => "claude", fakeRun({ is_error: true, result: "Not logged in" }));
    await assert.rejects(failed.summarize("Ana", conversa), /Not logged in/);
    const missing = new ClaudePlanAI(dir, undefined, () => null, fakeRun({}));
    await assert.rejects(missing.draft("Ana", conversa, ""), /não encontrado/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Banco antigo: ai_usage ganha o provider 'claude' sem perder registros", () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-claude-"));
  const file = join(dir, "inbox.db");
  try {
    const old = new DatabaseSync(file);
    old.exec(`create table ai_usage (id integer primary key, at integer not null,
      provider text not null check (provider in ('jev','deepseek','local')),
      kind text not null check (kind in ('classificar','rascunho','resumo')), chat_jid text, model text not null,
      input_tokens integer not null default 0, output_tokens integer not null default 0, cached_tokens integer not null default 0,
      cost_usd real not null default 0, label text, confidence real, needs_reply real, urgent real, ok integer not null default 1);
      insert into ai_usage (at, provider, kind, model) values (1, 'deepseek', 'resumo', 'deepseek-v4-pro');`);
    old.close();
    const store = new Store(file);
    store.recordAiUsage({
      at: 2, provider: "claude", kind: "rascunho", chatJid: null, model: "claude-sonnet",
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, costUsd: 0,
      label: null, confidence: null, needsReply: null, urgent: null, ok: true,
    });
    const rows = store.db.prepare("select provider from ai_usage order by at").all() as { provider: string }[];
    assert.deepEqual(rows.map((r) => r.provider), ["deepseek", "claude"]);
    const indexes = store.db.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'ai_usage'").all() as { name: string }[];
    assert.deepEqual(indexes.map((i) => i.name).sort(), ["ai_usage_at", "ai_usage_chat"]);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
