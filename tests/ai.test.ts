import assert from "node:assert/strict";
import { test } from "node:test";
import { guardDraft, parseSummary } from "../server/ai.ts";

test("resumo da IA local: lê o formato pedido e tolera variações", () => {
  const s = parseSummary("RESUMO: Ana quer carro amanhã às 7h para Guarulhos.\nPEDIDO: valor para 3 pessoas\nPROXIMO PASSO: enviar cotação");
  assert.equal(s.pedido, "valor para 3 pessoas");
  assert.equal(s.proximoPasso, "enviar cotação");
  assert.equal(parseSummary("texto solto sem rótulos").resumo, "texto solto sem rótulos");
});

test("trava do rascunho: tira preço/horário/placa que não estão na conversa", () => {
  const conv = "Ana: Preciso de carro amanhã às 7h para Guarulhos. Qual o valor?";
  const g = guardDraft("Bom dia, Ana! O valor é de R$ 300,00. Saímos às 7h, combinado?", conv);
  assert.ok(!g.includes("300"));
  assert.ok(g.includes("7h"));
  assert.ok(g.endsWith("Vou confirmar o valor e já te retorno."));
  assert.equal(guardDraft("Placa ABC1D23 confirmada.", conv), "Vou confirmar os detalhes e já te retorno.");
  assert.equal(guardDraft("Combinado, Ana!", conv), "Combinado, Ana!");
});

test("resumo com os rótulos na mesma linha", () => {
  const s = parseSummary("RESUMO: Ana pediu carro. PEDIDO: Valor do carro. PRÓXIMO PASSO: Informar o valor.");
  assert.deepEqual(s, { resumo: "Ana pediu carro.", pedido: "Valor do carro.", proximoPasso: "Informar o valor." });
});

test("trava do rascunho: nunca sugere pedir cartão, senha ou CPF", () => {
  const conv = "Ana: Qual o valor?";
  const g = guardDraft("Vamos confirmar o valor. Por favor, forneça o número do seu cartão de crédito.", conv);
  assert.ok(!/cart/i.test(g));
});

test("parseAudioSummary lê JSON com texto em volta e corrige prioridade inválida", async () => {
  const { parseAudioSummary } = await import("../server/ai.ts");
  const s = parseAudioSummary('Aqui: {"assunto":"Reserva amanhã","pontos":["GRU 8h"," "],"tratativa":"Confirmar motorista","prioridade":"urgente","motivo":"x"}');
  assert.equal(s.assunto, "Reserva amanhã");
  assert.deepEqual(s.pontos, ["GRU 8h"]);
  assert.equal(s.prioridade, "media");
  assert.throws(() => parseAudioSummary("sem json"), /resumo legível/);
});

test("perfil pela IA: lê JSON com texto em volta, limpa listas e recusa resposta vazia", async () => {
  const { parsePersona } = await import("../server/ai.ts");
  const p = parsePersona('Segue: {"resumo":"Cliente  corporativo","trabalho":["Diretor na Acme"," "],"pagamento":"não é lista","atencao":["a","b","c","d","e","f"]}');
  assert.equal(p.resumo, "Cliente corporativo");
  assert.deepEqual(p.trabalho, ["Diretor na Acme"]);
  assert.deepEqual(p.pagamento, []);
  assert.equal(p.atencao.length, 5);
  assert.throws(() => parsePersona('{"resumo":"","trabalho":[]}'));
  assert.throws(() => parsePersona("sem json"));
});
