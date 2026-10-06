import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { estimateCostUsd, isDeepseekPeak } from "../server/pricing.ts";

const PN = "5511999990000@s.whatsapp.net";
const LID = "123456789@lid";
const add = (s: Store, jid: string, at: number) =>
  s.addMessage({ chatJid: jid, id: `m${at}`, rawJid: jid, fromMe: false, at, text: "oi", kind: "text" }, false);
const usage = (inputTokens: number, outputTokens = 0, cachedTokens = 0) => ({ inputTokens, outputTokens, cachedTokens });

test("preço: Jev só cobra entrada; DeepSeek cobra cache 50× mais barato e dobra no pico", () => {
  assert.equal(estimateCostUsd("jev", usage(1_000_000, 50)), 0.042);
  const offPeak = new Date("2026-10-03T15:00:00Z"); // sábado
  assert.ok(!isDeepseekPeak(offPeak));
  assert.ok(isDeepseekPeak(new Date("2026-10-05T07:00:00Z"))); // segunda 07h UTC
  // 1M frescos + 1M em cache + 1M de saída
  assert.equal(Number(estimateCostUsd("deepseek", usage(2_000_000, 1_000_000, 1_000_000), offPeak).toFixed(6)), 0.753);
  assert.equal(Number(estimateCostUsd("deepseek", usage(2_000_000, 1_000_000, 1_000_000), new Date("2026-10-05T07:00:00Z")).toFixed(6)), 1.506);
  assert.equal(estimateCostUsd("local", usage(5000, 200)), 0);
});

test("uso de IA: total por conversa, resumo do painel e classificações", () => {
  const s = new Store(":memory:");
  add(s, PN, 1000);
  const at = Date.parse("2026-10-06T12:00:00Z");
  const row = { at, chatJid: PN, model: "m", confidence: null, needsReply: null, urgent: null, label: null, ok: true };
  s.recordAiUsage({ ...row, provider: "jev", kind: "classificar", usage: usage(2000), costUsd: 0.000084, label: "Cotação", confidence: 0.9, needsReply: 1, urgent: 0 });
  s.recordAiUsage({ ...row, at: at + 60_000, provider: "jev", kind: "classificar", usage: usage(1000), costUsd: 0.000042, label: "Reserva", confidence: 0.7, needsReply: 0, urgent: 0 });
  s.recordAiUsage({ ...row, at: at + 120_000, provider: "jev", kind: "classificar", usage: usage(0), costUsd: 0, ok: false });
  s.recordAiUsage({ ...row, at: at + 86_400_000, provider: "deepseek", kind: "rascunho", usage: usage(500, 100, 200), costUsd: 0.0001 });

  const chat = s.getChat(PN)!;
  assert.equal(chat.aiUsage.calls, 4);
  assert.equal(chat.aiUsage.tokens, 3600);
  assert.ok(Math.abs(chat.aiUsage.costUsd - 0.000226) < 1e-9);

  const all = s.aiUsageSummary(null, 5);
  assert.equal(all.usdBrl, 5);
  assert.equal(all.totals.calls, 4);
  assert.equal(all.totals.failures, 1);
  assert.equal(all.totals.inputTokens, 3500);
  assert.equal(all.totals.cachedTokens, 200);
  assert.deepEqual(all.byKind.map((k) => [k.kind, k.calls]), [["classificar", 3], ["rascunho", 1]]);
  assert.deepEqual(all.byProvider.map((p) => p.provider), ["jev", "deepseek"]);
  assert.deepEqual(all.byDay.map((d) => [d.day, d.calls]), [["2026-10-06", 3], ["2026-10-07", 1]]);
  assert.equal(all.classification.total, 3);
  assert.equal(all.classification.failures, 1);
  assert.ok(Math.abs(all.classification.avgConfidence! - 0.8) < 1e-9);
  assert.equal(all.classification.needsReplyShare, 0.5);
  assert.deepEqual(all.classification.byLabel.map((l) => [l.label, l.count]), [["Cotação", 1], ["Reserva", 1]]);
  assert.deepEqual(all.topChats.map((c) => [c.jid, c.calls]), [[PN, 4]]);

  // Só o último dia entra no recorte.
  const recent = s.aiUsageSummary(at + 86_000_000, 5);
  assert.equal(recent.totals.calls, 1);
  assert.equal(recent.classification.total, 0);
  assert.equal(recent.classification.avgConfidence, null);
});

test("uso de IA acompanha a fusão LID → número", () => {
  const s = new Store(":memory:");
  add(s, PN, 1000);
  add(s, LID, 2000);
  const base = { at: 1, model: "m", usage: usage(10), costUsd: 0, label: null, confidence: null, needsReply: null, urgent: null, ok: true } as const;
  s.recordAiUsage({ ...base, provider: "jev", kind: "classificar", chatJid: LID });
  s.mapLid(LID, PN);
  assert.equal(s.getChat(PN)?.aiUsage.calls, 1);
  assert.equal(s.getChat(LID), null);
});
