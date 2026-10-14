// tests/vigilancia-job.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { Vigilancia, type ConfigVigilancia, type DepsVigilancia } from "../server/vigilancia/job.ts";
import { CONFIG_REGRAS_PADRAO, type OsVigiada, type Posicao, type Rota } from "../server/vigilancia/tipos.ts";

const AGORA = Date.UTC(2026, 9, 14, 16, 0);
const MIN = 60_000;
const CFG: ConfigVigilancia = { grupoJid: "grupo@g.us", janelaMin: 120, cadenciaMin: 5, ensaio: false, regras: CONFIG_REGRAS_PADRAO };
const os = (over: Partial<OsVigiada> = {}): OsVigiada => ({ id: "os-1", numero: "OS-1", saidaAt: AGORA + 40 * MIN, endereco: "Av. Paulista, 1000", cliente: "Acme", passageiros: "Fulano", motorista: "Beto", placa: "ABC-1D23", ...over });
const pos = (over: Partial<Posicao> = {}): Posicao => ({ placa: "ABC-1D23", lat: -23.6, lon: -46.7, endereco: "Castello", velocidadeKmh: 60, ignicao: true, fixAt: AGORA - MIN, motorista: "Beto", ...over });

function montar(over: Partial<DepsVigilancia> & { rota?: Rota | null; lista?: OsVigiada[]; frota?: Map<string, Posicao> } = {}) {
  const store = new Store(":memory:");
  const enviados: { jid: string; texto: string }[] = [];
  const usos: boolean[] = [];
  const logs: string[] = [];
  let agora = AGORA;
  const deps: DepsVigilancia = {
    dataverse: { osNaJanela: async () => over.lista ?? [os()] },
    infleet: { frota: async () => over.frota ?? new Map([["ABC1D23", pos()]]) },
    geocodificador: { localizar: async () => ({ lat: -23.5614, lon: -46.6559 }) },
    roteador: { rota: async () => (over.rota === undefined ? { minutos: 20, km: 15, semTransito: false } : over.rota) },
    redator: { redigir: async (av) => ({ texto: `aviso ${av.nivel} ${av.fatos.os}`, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, reserva: false, erro: null }) },
    estado: store,
    enviar: async (jid, texto) => (enviados.push({ jid, texto }), "id-1"),
    registrarUso: (_u, ok) => void usos.push(ok),
    log: (m) => void logs.push(m),
    agora: () => agora,
    ...over,
  };
  return { deps, store, enviados, usos, logs, avancar: (ms: number) => (agora += ms) };
}

test("ciclo: OS ok não envia nada nem grava estado", async () => {
  const m = montar();
  const r = await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(r.avaliadas.length, 1);
  assert.equal(r.avaliadas[0].nivel, "ok");
  assert.equal(r.enviadas.length, 0);
  assert.equal(m.enviados.length, 0);
  assert.equal(m.store.vigilanciaNivel("os-1"), null);
});

test("ciclo: entra em atraso → envia uma vez e grava; repete o nível → não reenvia; volta a ok → avisa normalizou", async () => {
  const m = montar({ rota: { minutos: 55, km: 40, semTransito: false } });
  const v = new Vigilancia(m.deps, CFG);
  await v.ciclo();
  assert.deepEqual(m.enviados, [{ jid: "grupo@g.us", texto: "aviso atraso OS-1" }]);
  assert.equal(m.store.vigilanciaNivel("os-1"), "atraso");
  assert.deepEqual(m.usos, [true]);
  await v.ciclo();
  assert.equal(m.enviados.length, 1);
  m.deps.roteador = { rota: async () => ({ minutos: 10, km: 5, semTransito: false }) };
  await v.ciclo();
  assert.equal(m.enviados.length, 2);
  assert.equal(m.enviados[1].texto, "aviso ok OS-1");
  assert.equal(m.store.vigilanciaNivel("os-1"), "ok");
});

test("ciclo: envio que não devolve id (WhatsApp fora) não grava o estado e tenta de novo", async () => {
  const m = montar({ rota: { minutos: 55, km: 40, semTransito: false }, enviar: async () => null });
  const v = new Vigilancia(m.deps, CFG);
  const r = await v.ciclo();
  assert.equal(r.enviadas.length, 0);
  assert.match(r.erros.join(" "), /WhatsApp/);
  assert.equal(m.store.vigilanciaNivel("os-1"), null);
});

test("ciclo: modo ensaio usa o template, não chama a API, não envia e não grava", async () => {
  let redigiu = false;
  const m = montar({ rota: { minutos: 55, km: 40, semTransito: false }, redator: { redigir: async () => (redigiu = true, { texto: "x", usage: null, reserva: false, erro: null }) } });
  const r = await new Vigilancia(m.deps, { ...CFG, ensaio: true }).ciclo();
  assert.equal(r.ensaio, true);
  assert.equal(r.enviadas.length, 1);
  assert.match(r.enviadas[0].texto, /^\*⚠️ Risco de atraso — OS-1\*/);
  assert.equal(redigiu, false);
  assert.equal(m.enviados.length, 0);
  assert.equal(m.store.vigilanciaNivel("os-1"), null);
});

test("ciclo: só pede rota a menos de 60 min do embarque", async () => {
  let rotas = 0;
  const m = montar({ lista: [os({ saidaAt: AGORA + 90 * MIN })], roteador: { rota: async () => (rotas++, null) } });
  await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(rotas, 0);
  m.deps.dataverse = { osNaJanela: async () => [os({ saidaAt: AGORA + 50 * MIN })] };
  await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(rotas, 1);
});

test("ciclo: carro parado é detectado com a memória entre ciclos", async () => {
  const m = montar({ lista: [os({ saidaAt: AGORA + 25 * MIN })], rota: null });
  let fixAt = AGORA - MIN;
  m.deps.infleet = { frota: async () => new Map([["ABC1D23", pos({ velocidadeKmh: 0, ignicao: false, fixAt })]]) };
  const v = new Vigilancia(m.deps, CFG);
  const r1 = await v.ciclo();
  assert.equal(r1.avaliadas[0].nivel, "ok");
  assert.equal(m.enviados.length, 0);
  m.avancar(12 * MIN);
  fixAt = AGORA + 12 * MIN - MIN;
  const r2 = await v.ciclo();
  assert.equal(r2.avaliadas[0].nivel, "parado");
  assert.equal(m.enviados.length, 1);
});

test("ciclo: Dataverse fora pula o ciclo; na 3ª falha seguida avisa o grupo uma vez por hora e avisa quando volta", async () => {
  const m = montar({ dataverse: { osNaJanela: async () => { throw new Error("HTTP 500"); } } });
  const v = new Vigilancia(m.deps, CFG);
  await v.ciclo();
  await v.ciclo();
  assert.equal(m.enviados.length, 0);
  const r = await v.ciclo();
  assert.match(r.erros[0], /Dataverse/);
  assert.equal(m.enviados.length, 1);
  assert.match(m.enviados[0].texto, /vigilância sem dados/i);
  await v.ciclo();
  assert.equal(m.enviados.length, 1);
  m.avancar(61 * MIN);
  await v.ciclo();
  assert.equal(m.enviados.length, 2);
  m.deps.dataverse = { osNaJanela: async () => [] };
  await v.ciclo();
  assert.equal(m.enviados.length, 3);
  assert.match(m.enviados[2].texto, /vigilância normalizada/i);
});

test("ciclo: rota indisponível só gera aviso de fonte depois de 3 ciclos e a OS é avaliada sem rota", async () => {
  const m = montar({ lista: [os({ saidaAt: AGORA + 30 * MIN })], rota: null });
  const v = new Vigilancia(m.deps, CFG);
  const r = await v.ciclo();
  assert.equal(r.avaliadas[0].nivel, "ok");
  assert.equal(r.avaliadas[0].folgaMin, null);
  await v.ciclo();
  await v.ciclo();
  assert.equal(m.enviados.length, 1);
  assert.match(m.enviados[0].texto, /rota/i);
});

test("ciclo: estado de OS cuja saída passou há mais de 30 min é apagado", async () => {
  const m = montar();
  m.store.vigilanciaRegistrar("velha", "atraso", AGORA - 31 * MIN, AGORA - 60 * MIN);
  m.store.vigilanciaRegistrar("recente", "atraso", AGORA - 10 * MIN, AGORA - 20 * MIN);
  await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(m.store.vigilanciaNivel("velha"), null);
  assert.equal(m.store.vigilanciaNivel("recente"), "atraso");
});

test("iniciar/parar: ciclos não se sobrepõem e parar cancela o timer", async () => {
  let ativos = 0, max = 0;
  const m = montar({ dataverse: { osNaJanela: async () => { ativos++; max = Math.max(max, ativos); await new Promise((r) => setTimeout(r, 20)); ativos--; return []; } } });
  const v = new Vigilancia(m.deps, { ...CFG, cadenciaMin: 0.0002 }); // ~12 ms
  v.iniciar();
  await new Promise((r) => setTimeout(r, 80));
  v.parar();
  assert.equal(max, 1);
  assert.ok(v.ultimo());
  const n = v.ultimo()!.em;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(v.ultimo()!.em, n);
});
