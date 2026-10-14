import assert from "node:assert/strict";
import { test } from "node:test";
import { avaliar, deveEnviar, marcarParada } from "../server/vigilancia/regras.ts";
import { CONFIG_REGRAS_PADRAO, type OsVigiada, type Posicao } from "../server/vigilancia/tipos.ts";

const AGORA = Date.UTC(2026, 9, 14, 16, 0); // 13:00 em São Paulo
const MIN = 60_000;
const os = (over: Partial<OsVigiada> = {}): OsVigiada => ({
  id: "os-1", numero: "OS-1234", saidaAt: AGORA + 40 * MIN, endereco: "Av. Paulista, 1000", cliente: "Acme", passageiros: "Fulano", motorista: "Beto", placa: "ABC1D23", ...over,
});
const pos = (over: Partial<Posicao> = {}): Posicao => ({ placa: "ABC1D23", lat: -23.6, lon: -46.7, endereco: "Rod. Castello Branco", velocidadeKmh: 60, ignicao: true, fixAt: AGORA - 1 * MIN, motorista: "Beto", ...over });
const embarque = { lat: -23.5614, lon: -46.6559 };
const base = { os: os(), posicao: pos(), rota: { minutos: 20, km: 15, semTransito: false }, embarque, parada: null, agora: AGORA, cfg: CONFIG_REGRAS_PADRAO };

test("regras: chega com folga maior que a margem é ok", () => {
  const a = avaliar(base);
  assert.equal(a.nivel, "ok");
  assert.equal(a.fatos.folgaMin, 20);
  assert.equal(a.fatos.chegadaAt, AGORA + 20 * MIN);
});

test("regras: folga menor que a margem é atenção", () => {
  assert.equal(avaliar({ ...base, rota: { minutos: 35, km: 30, semTransito: false } }).nivel, "atencao");
});

test("regras: previsão depois do horário é atraso, com folga negativa", () => {
  const a = avaliar({ ...base, rota: { minutos: 52, km: 40, semTransito: true } });
  assert.equal(a.nivel, "atraso");
  assert.equal(a.fatos.folgaMin, -12);
  assert.equal(a.fatos.semTransito, true);
});

test("regras: OS sem motorista ou sem veículo é sem_programacao, antes de qualquer outra regra", () => {
  assert.equal(avaliar({ ...base, os: os({ motorista: null }) }).nivel, "sem_programacao");
  assert.equal(avaliar({ ...base, os: os({ placa: null }), posicao: null }).nivel, "sem_programacao");
});

test("regras: carro a menos de 1 km do embarque é ok mesmo parado", () => {
  const a = avaliar({ ...base, os: os({ saidaAt: AGORA + 5 * MIN }), posicao: pos({ lat: -23.5620, lon: -46.6565, velocidadeKmh: 0, ignicao: false }), parada: { lat: -23.562, lon: -46.6565, desdeAt: AGORA - 30 * MIN }, rota: null });
  assert.equal(a.nivel, "ok");
  assert.ok((a.fatos.distanciaKm ?? 99) < 1);
});

test("regras: sem sinal há mais de 10 min a menos de 30 min do embarque", () => {
  const a = avaliar({ ...base, os: os({ saidaAt: AGORA + 25 * MIN }), posicao: pos({ fixAt: AGORA - 15 * MIN }), rota: null });
  assert.equal(a.nivel, "sem_sinal");
  assert.equal(a.fatos.posicao?.minutosSemAtualizar, 15);
});

test("regras: parado há mais de 10 min longe do embarque perto da hora", () => {
  const a = avaliar({ ...base, os: os({ saidaAt: AGORA + 25 * MIN }), posicao: pos({ velocidadeKmh: 0, ignicao: false }), parada: { lat: -23.6, lon: -46.7, desdeAt: AGORA - 12 * MIN }, rota: null });
  assert.equal(a.nivel, "parado");
  assert.equal(a.fatos.paradoHaMin, 12);
});

test("regras: parado sem histórico não dispara; longe da hora também não", () => {
  assert.equal(avaliar({ ...base, os: os({ saidaAt: AGORA + 25 * MIN }), posicao: pos({ velocidadeKmh: 0, ignicao: false }), parada: null, rota: null }).nivel, "ok");
  assert.equal(avaliar({ ...base, os: os({ saidaAt: AGORA + 50 * MIN }), posicao: pos({ velocidadeKmh: 0, ignicao: false }), parada: { lat: -23.6, lon: -46.7, desdeAt: AGORA - 30 * MIN }, rota: null }).nivel, "ok");
});

test("regras: sem rota e sem posição só valem as regras de programação", () => {
  const a = avaliar({ ...base, posicao: null, rota: null, embarque: null });
  assert.equal(a.nivel, "ok");
  assert.equal(a.fatos.trajetoMin, null);
  assert.equal(a.fatos.distanciaKm, null);
});

test("marcarParada: mantém o início enquanto o carro não anda; reinicia ao mover ou ligar", () => {
  const p0 = marcarParada(undefined, pos({ velocidadeKmh: 0, ignicao: false, fixAt: AGORA - 20 * MIN }));
  assert.equal(p0.desdeAt, AGORA - 20 * MIN);
  const p1 = marcarParada(p0, pos({ velocidadeKmh: 0, ignicao: false, fixAt: AGORA - 5 * MIN, lat: -23.6001, lon: -46.7001 }));
  assert.equal(p1.desdeAt, AGORA - 20 * MIN);
  const p2 = marcarParada(p1, pos({ velocidadeKmh: 30, ignicao: true, fixAt: AGORA }));
  assert.equal(p2.desdeAt, AGORA);
  const p3 = marcarParada(p2, pos({ velocidadeKmh: 0, ignicao: false, fixAt: AGORA + MIN, lat: -23.61, lon: -46.71 }));
  assert.equal(p3.desdeAt, AGORA + MIN);
});

test("deveEnviar: só em mudança de nível, sem avisar ok sem alerta anterior nem atenção depois de atraso", () => {
  assert.equal(deveEnviar(null, "ok"), false);
  assert.equal(deveEnviar(null, "atencao"), true);
  assert.equal(deveEnviar("atencao", "atencao"), false);
  assert.equal(deveEnviar("atencao", "atraso"), true);
  assert.equal(deveEnviar("atraso", "atencao"), false);
  assert.equal(deveEnviar("atraso", "ok"), true);
  assert.equal(deveEnviar("ok", "sem_sinal"), true);
});
