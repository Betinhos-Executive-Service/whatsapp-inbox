import assert from "node:assert/strict";
import { test } from "node:test";
import type { Chat } from "../ui/api.ts";
import { priorityLevel, priorityScore } from "../ui/priority.ts";

const now = Date.UTC(2026, 9, 6, 12);
const base: Chat = {
  jid: "x", name: "x", phone: null, isGroup: false, lastAt: now - 3600_000, lastText: "?", lastFromMe: false, unread: 1,
  status: "aberta", label: null, labelSource: null, ai: null, aiError: null, note: null, reminderAt: null, extraLabels: [], pinnedAt: null, archived: false, mutedUntil: null, snoozedUntil: null, aiUsage: { calls: 0, tokens: 0, costUsd: 0 },
};

test("prioridade: urgente esperando resposta vem antes; resolvida e 'falei por último' no fim", () => {
  const urgent = { ...base, ai: { label: "Operação", confidence: 0.9, needsReply: 0.95, urgent: 0.9, priority: null, reason: null, at: now } };
  const calm = { ...base, unread: 0, ai: { label: "Outros", confidence: 0.9, needsReply: 0.1, urgent: 0, priority: null, reason: null, at: now } };
  assert.ok(priorityScore(urgent, now) > priorityScore(calm, now));
  assert.equal(priorityLevel(priorityScore(urgent, now)), "alta");
  assert.equal(priorityScore({ ...urgent, status: "resolvida" }, now), 0);
  assert.equal(priorityScore({ ...urgent, lastFromMe: true }, now), 0.05);
  assert.ok(priorityScore({ ...base, lastFromMe: true, reminderAt: now - 1 }, now) >= 0.3);
});

test("prioridade dita pela IA manda: alta sobe, baixa desce, média fica no meio", () => {
  const ai = { label: "Outros", confidence: 0.9, needsReply: 0.1, urgent: 0, reason: null, at: now };
  assert.equal(priorityLevel(priorityScore({ ...base, unread: 0, ai: { ...ai, priority: "alta" } }, now)), "alta");
  assert.equal(priorityLevel(priorityScore({ ...base, ai: { ...ai, needsReply: 0.95, urgent: 0.9, priority: "baixa" } }, now)), null);
  assert.equal(priorityLevel(priorityScore({ ...base, unread: 0, ai: { ...ai, priority: "media" } }, now)), "media");
  // Lembrete vencido vence a prioridade baixa.
  assert.ok(priorityScore({ ...base, reminderAt: now - 1, ai: { ...ai, priority: "baixa" } }, now) >= 0.3);
  assert.equal(priorityScore({ ...base, status: "resolvida", ai: { ...ai, priority: "alta" } }, now), 0);
});
