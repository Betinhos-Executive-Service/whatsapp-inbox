import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../server/db.ts";
import { DeepSeekAI } from "../server/deepseek.ts";

const msg = (fromMe: boolean, text: string, at: number): Message => ({ chatJid: "x", id: String(at), fromMe, at, text, kind: "text", media: null });
const conversa = [msg(false, "Bom dia! Preciso de carro amanhã às 7h para Guarulhos. Qual o valor?", 1_760_000_000_000)];

function fakeFetch(status: number, body: unknown, seen: { body?: any; auth?: string } = {}) {
  return (async (_url: string, init: RequestInit) => {
    seen.body = JSON.parse(String(init.body));
    seen.auth = (init.headers as Record<string, string>).authorization;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("DeepSeek: rascunho usa a chave, desliga o thinking e passa pela trava de preço", async () => {
  const seen: { body?: any; auth?: string } = {};
  const ai = new DeepSeekAI(
    fakeFetch(200, { choices: [{ message: { content: '"Bom dia! O valor é R$ 300,00. Saímos às 7h."' } }], usage: { prompt_tokens: 320, completion_tokens: 18, prompt_cache_hit_tokens: 64 } }, seen),
  );
  const { text, usage } = await ai.draft("sk-teste", "Ana", conversa, "");
  assert.deepEqual(usage, { inputTokens: 320, outputTokens: 18, cachedTokens: 64 });
  assert.equal(seen.auth, "Bearer sk-teste");
  assert.deepEqual(seen.body.thinking, { type: "disabled" });
  assert.match(seen.body.messages[1].content, /\[\d{2}\/\d{2}/); // mensagens com data/hora
  assert.ok(!text.includes("300"));
  assert.ok(text.includes("Vou confirmar o valor"));
  assert.ok(!text.startsWith('"'));
});

test("DeepSeek: resumo no formato de três partes", async () => {
  const ai = new DeepSeekAI(fakeFetch(200, { choices: [{ message: { content: "RESUMO: Ana quer carro amanhã.\nPEDIDO: valor\nPRÓXIMO PASSO: enviar cotação" } }] }));
  const { summary, usage } = await ai.summarize("k", "Ana", conversa);
  assert.deepEqual(summary, { resumo: "Ana quer carro amanhã.", pedido: "valor", proximoPasso: "enviar cotação" });
  assert.deepEqual(usage, { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }); // resposta sem "usage" não quebra
});

test("DeepSeek: classificação em JSON com prioridade e motivo; etiqueta fora da lista é erro", async () => {
  const labels = [{ name: "Cotação", description: "Preço" }, { name: "Operação", description: "Serviço em andamento" }];
  const seen: { body?: any } = {};
  const ai = new DeepSeekAI(
    fakeFetch(200, { choices: [{ message: { content: '{"etiqueta":"cotacao","confianca":0.9,"responder":0.95,"urgente":0.2,"prioridade":"media","motivo":"Pede valor para amanhã."}' } }] }, seen),
  );
  const { result: r } = await ai.classify("k", "Ana", conversa, labels);
  assert.deepEqual(r, { label: "Cotação", confidence: 0.9, needsReply: 0.95, urgent: 0.2, priority: "media", reason: "Pede valor para amanhã." });
  assert.deepEqual(seen.body.response_format, { type: "json_object" });
  assert.match(seen.body.messages[0].content, /- Cotação: Preço/);
  assert.match(seen.body.messages[0].content, /- alta: /);
  assert.ok(!seen.body.messages[1].content.includes("whatsapp.net"));
  const bad = new DeepSeekAI(fakeFetch(200, { choices: [{ message: { content: '{"etiqueta":"Reserva","responder":0.5,"urgente":0,"prioridade":"baixa"}' } }] }));
  await assert.rejects(bad.classify("k", "Ana", conversa, labels), /Etiqueta desconhecida/);
  const semJson = new DeepSeekAI(fakeFetch(200, { choices: [{ message: { content: "não sei" } }] }));
  await assert.rejects(semJson.classify("k", "Ana", conversa, labels), /JSON/);
  await assert.rejects(ai.classify("k", "Ana", conversa, labels.slice(0, 1)), /duas etiquetas/);
});

test("DeepSeek: erros viram mensagem clara", async () => {
  await assert.rejects(new DeepSeekAI(fakeFetch(401, { error: { message: "bad key" } })).draft("k", "Ana", conversa, ""), /Chave da DeepSeek inválida/);
  await assert.rejects(new DeepSeekAI(fakeFetch(402, {})).draft("k", "Ana", conversa, ""), /Sem saldo/);
  await assert.rejects(new DeepSeekAI(fakeFetch(200, { choices: [] })).draft("k", "Ana", conversa, ""), /vazia/);
});
