import assert from "node:assert/strict";
import { test } from "node:test";
import type { Chat } from "../ui/api.ts";
import { priorityLevel, priorityScore } from "../ui/priority.ts";

const now = Date.UTC(2026, 9, 6, 12);
const base: Chat = {
  jid: "x", name: "x", phone: null, isGroup: false, lastAt: now - 3600_000, lastText: "?", lastFromMe: false, unread: 1,
  status: "aberta", label: null, labelSource: null, ai: null, aiError: null, note: null, reminderAt: null, aiUsage: { calls: 0, tokens: 0, costUsd: 0 },
};

test("prioridade: urgente esperando resposta vem antes; resolvida e 'falei por último' no fim", () => {
  const urgent = { ...base, ai: { label: "Operação", confidence: 0.9, needsReply: 0.95, urgent: 0.9, at: now } };
  const calm = { ...base, unread: 0, ai: { label: "Outros", confidence: 0.9, needsReply: 0.1, urgent: 0, at: now } };
  assert.ok(priorityScore(urgent, now) > priorityScore(calm, now));
  assert.equal(priorityLevel(priorityScore(urgent, now)), "alta");
  assert.equal(priorityScore({ ...urgent, status: "resolvida" }, now), 0);
  assert.equal(priorityScore({ ...urgent, lastFromMe: true }, now), 0.05);
  assert.ok(priorityScore({ ...base, lastFromMe: true, reminderAt: now - 1 }, now) >= 0.3);
});
