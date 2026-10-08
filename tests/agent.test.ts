import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TOOLS, analysisSchema, analyzePrompt, extractJson, parseOutcome, schedulePrompt, scheduleSchema } from "../server/agent.ts";
import type { Chat, Message } from "../server/db.ts";

const chat = { jid: "5511999990000@s.whatsapp.net", name: "Ana", phone: "5511999990000", isGroup: false } as Chat;
const message = (over: Partial<Message>): Message => ({ chatJid: chat.jid, id: "m1", fromMe: false, at: Date.UTC(2026, 9, 8, 21, 0), text: "Carro amanhã 8h", kind: "text", media: null, deleted: false, sender: null, ...over }) as Message;

test("agente: analisar não grava no Dataverse; só agendar cria e propõe o voucher", () => {
  const read = AGENT_TOOLS.analisar;
  assert.ok(!read.allowed.some((t) => t.endsWith("create_record")));
  assert.ok(read.disallowed.includes("mcp__Dataverse_PROD__create_record"));
  assert.ok(read.disallowed.includes("mcp__whatsapp-inbox__propor_voucher"));
  const write = AGENT_TOOLS.agendar;
  assert.ok(write.allowed.includes("mcp__Dataverse_PROD__create_record"));
  assert.ok(write.allowed.includes("mcp__whatsapp-inbox__propor_voucher"));
  for (const tools of [read, write]) {
    for (const denied of ["mcp__Dataverse_PROD__update_record", "mcp__Dataverse_PROD__delete_record", "mcp__Dataverse_DEV", "Bash"]) assert.ok(tools.disallowed.includes(denied), denied);
    assert.ok(!tools.allowed.some((t) => tools.disallowed.includes(t)));
  }
});

test("agente: conversa com horário de Brasília, id e mídia; mensagens de sistema ficam de fora", () => {
  const p = analyzePrompt(chat, [message({}), message({ id: "m2", fromMe: true, text: "Certo", media: { type: "audio" } as Message["media"] }), message({ id: "s", kind: "system", text: "entrou" })], Date.UTC(2026, 9, 8, 21, 5));
  assert.match(p.user, /jid \(use nas ferramentas do WhatsApp Inbox\): 5511999990000@s\.whatsapp\.net/);
  assert.match(p.user, /Agora: 08\/10\/2026 18:05/);
  assert.match(p.user, /\[08\/10\/2026 18:00\] Ana: Carro amanhã 8h {2}#m1/);
  assert.match(p.user, /Betinhos: Certo \{audio\} {2}#m2/);
  assert.ok(!p.user.includes("entrou"));
  assert.match(p.system, /não grave nada/);
});

test("agente: agendar leva o resumo e o plano aprovados; OS existente só gera voucher", () => {
  const plano = { servicos: [{ reserva: { cr40f_trajeto: "Hotel / GRU" }, passageiros: [] }] };
  const p = schedulePrompt(chat, { resultado: "pronto", resumo: "r", previa: "*Solicitado*", os: [], plano });
  assert.match(p.user, /Ação aprovada: agendar/);
  assert.ok(p.user.includes("*Solicitado*"));
  assert.ok(p.user.includes(JSON.stringify(plano)));
  const v = schedulePrompt(chat, { resultado: "ja_existia", resumo: "r", previa: "", os: ["OS-1"] });
  assert.match(v.user, /só gerar o voucher das OS existentes \(OS-1\)\. Não crie nada/);
});

test("agente: lê o JSON puro, em bloco ```json ou no meio do texto; fora do formato vira erro", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Pronto.\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Resultado: {"a":{"b":3}} fim'), { a: { b: 3 } });
  const a = parseOutcome(analysisSchema, '{"resultado":"pronto","resumo":"ok","previa":"• x","os":"OS-1","plano":{"servicos":[]}}');
  assert.equal(a.resultado, "pronto");
  assert.deepEqual(a.os, []);
  const s = parseOutcome(scheduleSchema, 'feito {"resultado":"agendado","os":["OS-9"],"resumo":"Agendado."}');
  assert.deepEqual(s.os, ["OS-9"]);
  assert.throws(() => parseOutcome(scheduleSchema, "não consegui"), /fora do formato esperado: não consegui/);
});
