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
  const ai = new DeepSeekAI(fakeFetch(200, { choices: [{ message: { content: '"Bom dia! O valor é R$ 300,00. Saímos às 7h."' } }] }, seen));
  const text = await ai.draft("sk-teste", "Ana", conversa, "");
  assert.equal(seen.auth, "Bearer sk-teste");
  assert.deepEqual(seen.body.thinking, { type: "disabled" });
  assert.match(seen.body.messages[1].content, /\[\d{2}\/\d{2}/); // mensagens com data/hora
  assert.ok(!text.includes("300"));
  assert.ok(text.includes("Vou confirmar o valor"));
  assert.ok(!text.startsWith('"'));
});

test("DeepSeek: resumo no formato de três partes", async () => {
  const ai = new DeepSeekAI(fakeFetch(200, { choices: [{ message: { content: "RESUMO: Ana quer carro amanhã.\nPEDIDO: valor\nPRÓXIMO PASSO: enviar cotação" } }] }));
  assert.deepEqual(await ai.summarize("k", "Ana", conversa), { resumo: "Ana quer carro amanhã.", pedido: "valor", proximoPasso: "enviar cotação" });
});

test("DeepSeek: erros viram mensagem clara", async () => {
  await assert.rejects(new DeepSeekAI(fakeFetch(401, { error: { message: "bad key" } })).draft("k", "Ana", conversa, ""), /Chave da DeepSeek inválida/);
  await assert.rejects(new DeepSeekAI(fakeFetch(402, {})).draft("k", "Ana", conversa, ""), /Sem saldo/);
  await assert.rejects(new DeepSeekAI(fakeFetch(200, { choices: [] })).draft("k", "Ana", conversa, ""), /vazia/);
});
