// tests/vigilancia-mensagem.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Redator, SISTEMA, templateReserva } from "../server/vigilancia/mensagem.ts";
import type { Avaliacao } from "../server/vigilancia/tipos.ts";

const AGORA = Date.UTC(2026, 9, 14, 16, 0); // 13:00 SP
const MIN = 60_000;
const av = (over: Partial<Avaliacao> = {}, fatos: Partial<Avaliacao["fatos"]> = {}): Avaliacao => ({
  osId: "os-1", nivel: "atraso",
  fatos: { os: "OS-1234", cliente: "Acme", passageiros: "Fulano", motorista: "Beto", placa: "ABC1D23", embarque: "Av. Paulista, 1000", saidaAt: AGORA + 40 * MIN, faltamMin: 40, posicao: { endereco: "Rod. Castello Branco km 20", minutosSemAtualizar: 1, velocidadeKmh: 60 }, distanciaKm: 30, trajetoMin: 52, chegadaAt: AGORA + 52 * MIN, folgaMin: -12, semTransito: false, paradoHaMin: null, ...fatos },
  ...over,
});

test("templateReserva: atraso com todos os fatos, em formato WhatsApp", () => {
  const t = templateReserva(av());
  assert.equal(t.split("\n")[0], "*⚠️ Risco de atraso — OS-1234*");
  assert.match(t, /• Cliente: Acme · Passageiro: Fulano/);
  assert.match(t, /• Motorista: Beto · Placa ABC1D23/);
  assert.match(t, /• Embarque 13:40 em Av\. Paulista, 1000/);
  assert.match(t, /• Carro em Rod\. Castello Branco km 20, previsão 13:52 \(12 min de atraso, com trânsito\)/);
});

test("templateReserva: títulos por nível e normalização", () => {
  assert.match(templateReserva(av({ nivel: "atencao" }, { folgaMin: 5, trajetoMin: 35, chegadaAt: AGORA + 35 * MIN })), /^\*🕒 Atenção — OS-1234\*/);
  assert.match(templateReserva(av({ nivel: "atencao" }, { folgaMin: 5, trajetoMin: 35, chegadaAt: AGORA + 35 * MIN, semTransito: true })), /previsão 13:35 \(5 min de folga, sem trânsito\)/);
  assert.match(templateReserva(av({ nivel: "sem_sinal" }, { posicao: { endereco: "Rod. X", minutosSemAtualizar: 15, velocidadeKmh: 0 }, trajetoMin: null, chegadaAt: null, folgaMin: null })), /^\*📵 Sem sinal — OS-1234\*[\s\S]*sem atualizar há 15 min/);
  assert.match(templateReserva(av({ nivel: "parado" }, { paradoHaMin: 12, trajetoMin: null, chegadaAt: null, folgaMin: null })), /^\*🛑 Carro parado — OS-1234\*[\s\S]*parado há 12 min a 30 km do embarque/);
  assert.match(templateReserva(av({ nivel: "sem_programacao" }, { motorista: null, placa: null, posicao: null, distanciaKm: null, trajetoMin: null, chegadaAt: null, folgaMin: null })), /^\*❗ Sem programação — OS-1234\*[\s\S]*• Motorista: — · Placa —/);
  assert.match(templateReserva(av({ nivel: "ok" }, { folgaMin: 15, trajetoMin: 25, chegadaAt: AGORA + 25 * MIN })), /^\*✅ Normalizou — OS-1234\*/);
});

test("Redator: chama a API com o prompt fixo em cache, effort low e devolve o texto", async () => {
  let pedido: any = null;
  const api = () => ({ beta: { messages: { create: async (body: any) => (pedido = body, { stop_reason: "end_turn", content: [{ type: "text", text: "  *⚠️ Risco de atraso — OS-1234*\n• texto do modelo  " }], usage: { input_tokens: 500, output_tokens: 40, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } }) } } }) as any;
  const r = new Redator(() => "sk-teste", api);
  const out = await r.redigir(av());
  assert.equal(out.texto, "*⚠️ Risco de atraso — OS-1234*\n• texto do modelo");
  assert.equal(out.reserva, false);
  assert.deepEqual(out.usage, { inputTokens: 800, outputTokens: 40, cachedTokens: 300 });
  assert.equal(pedido.model, "claude-opus-5-5");
  assert.equal(pedido.max_tokens, 1024);
  assert.deepEqual(pedido.output_config, { effort: "low" });
  assert.deepEqual(pedido.cache_control, { type: "ephemeral" });
  assert.equal(pedido.system, SISTEMA);
  assert.deepEqual(pedido.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(pedido.fallbacks, "default");
  assert.match(pedido.messages[0].content, /"os": "OS-1234"/);
  assert.match(pedido.messages[0].content, /"nivel": "atraso"/);
});

test("Redator: sem chave, erro da API, recusa ou resposta vazia caem no template", async () => {
  const semChave = await new Redator(() => null, () => ({}) as any).redigir(av());
  assert.equal(semChave.reserva, true);
  assert.match(semChave.texto, /^\*⚠️ Risco de atraso — OS-1234\*/);
  assert.match(semChave.erro ?? "", /chave/i);
  const falha = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => { throw new Error("boom"); } } } }) as any).redigir(av());
  assert.equal(falha.reserva, true);
  assert.equal(falha.erro, "boom");
  const recusa = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } }) } } }) as any).redigir(av());
  assert.equal(recusa.reserva, true);
  const vazio = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "   " }], usage: { input_tokens: 1, output_tokens: 0 } }) } } }) as any).redigir(av());
  assert.equal(vazio.reserva, true);
});

test("Redator: resposta longa demais (mais de 12 linhas) cai no template", async () => {
  const longa = Array.from({ length: 13 }, (_, i) => `linha ${i}`).join("\n");
  const r = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: longa }], usage: { input_tokens: 1, output_tokens: 1 } }) } } }) as any).redigir(av());
  assert.equal(r.reserva, true);
});
