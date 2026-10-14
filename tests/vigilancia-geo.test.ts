import assert from "node:assert/strict";
import { test } from "node:test";
import { Geocodificador, Roteador } from "../server/vigilancia/geo.ts";
import type { Coord } from "../server/vigilancia/tipos.ts";

function cacheMemoria() {
  const m = new Map<string, Coord>();
  return { geocacheGet: (e: string) => m.get(e) ?? null, geocacheSet: (e: string, c: Coord) => void m.set(e, c), m };
}
const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("geocodificador: consulta a Nominatim uma vez e guarda no cache", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => (urls.push(u), resposta([{ lat: "-23.56", lon: "-46.65", display_name: "Av. Paulista" }]))) as typeof fetch;
  const cache = cacheMemoria();
  const g = new Geocodificador(cache, f, async () => undefined, () => 0);
  assert.deepEqual(await g.localizar("Av. Paulista, 1000"), { lat: -23.56, lon: -46.65 });
  assert.deepEqual(await g.localizar("Av. Paulista, 1000"), { lat: -23.56, lon: -46.65 });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /countrycodes=br/);
  assert.match(urls[0], /q=Av\.%20Paulista%2C%201000/);
});

test("geocodificador: endereço não encontrado devolve null e não repete por 60 min", async () => {
  let n = 0;
  const f = (async () => (n++, resposta([]))) as typeof fetch;
  let agora = 0;
  const g = new Geocodificador(cacheMemoria(), f, async () => undefined, () => agora);
  assert.equal(await g.localizar("Rua Inexistente 999"), null);
  assert.equal(await g.localizar("Rua Inexistente 999"), null);
  assert.equal(n, 1);
  agora = 61 * 60_000;
  assert.equal(await g.localizar("Rua Inexistente 999"), null);
  assert.equal(n, 2);
});

test("geocodificador: sem resultado com ' - ' tenta só o texto antes do último ' - ' e guarda com a chave original", async () => {
  const urls: string[] = [];
  const esperas: number[] = [];
  const f = (async (u: string) => (urls.push(u), resposta(urls.length === 1 ? [] : [{ lat: "-23.43", lon: "-46.47" }]))) as typeof fetch;
  const cache = cacheMemoria();
  const g = new Geocodificador(cache, f, async (ms) => void esperas.push(ms), () => 0);
  assert.deepEqual(await g.localizar("Aeroporto de Guarulhos - Terminal 3 - Voo LA 8127"), { lat: -23.43, lon: -46.47 });
  assert.equal(urls.length, 2);
  assert.match(urls[0], /q=Aeroporto%20de%20Guarulhos%20-%20Terminal%203%20-%20Voo%20LA%208127$/);
  assert.match(urls[1], /q=Aeroporto%20de%20Guarulhos%20-%20Terminal%203$/);
  assert.deepEqual(esperas, [1100]);
  assert.deepEqual([...cache.m.keys()], ["Aeroporto de Guarulhos - Terminal 3 - Voo LA 8127"]);
  assert.deepEqual(await g.localizar("Aeroporto de Guarulhos - Terminal 3 - Voo LA 8127"), { lat: -23.43, lon: -46.47 });
  assert.equal(urls.length, 2);
});

test("geocodificador: espera 1,1 s entre consultas de rede", async () => {
  const esperas: number[] = [];
  const f = (async () => resposta([{ lat: "1", lon: "2" }])) as typeof fetch;
  const g = new Geocodificador(cacheMemoria(), f, async (ms) => void esperas.push(ms), () => 0);
  await g.localizar("A");
  await g.localizar("B");
  assert.deepEqual(esperas, [1100]);
});

test("roteador: TomTom com trânsito quando há chave", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => (urls.push(u), resposta({ routes: [{ summary: { lengthInMeters: 15200, travelTimeInSeconds: 1500, trafficDelayInSeconds: 300 } }] }))) as typeof fetch;
  const r = new Roteador("chave", f);
  assert.deepEqual(await r.rota({ lat: -23.6, lon: -46.7 }, { lat: -23.56, lon: -46.65 }), { minutos: 25, km: 15.2, semTransito: false });
  assert.match(urls[0], /api\.tomtom\.com\/routing\/1\/calculateRoute\/-23\.6,-46\.7:-23\.56,-46\.65\/json\?/);
  assert.match(urls[0], /traffic=true/);
});

test("roteador: sem chave ou com TomTom fora cai no OSRM, marcado sem trânsito", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    if (u.includes("tomtom")) return resposta({}, 500);
    return resposta({ code: "Ok", routes: [{ distance: 15200, duration: 1200 }] });
  }) as typeof fetch;
  assert.deepEqual(await new Roteador("chave", f).rota({ lat: -23.6, lon: -46.7 }, { lat: -23.56, lon: -46.65 }), { minutos: 20, km: 15.2, semTransito: true });
  assert.equal(urls.filter((u) => u.includes("osrm")).length, 1);
  urls.length = 0;
  await new Roteador(null, f).rota({ lat: -23.6, lon: -46.7 }, { lat: -23.56, lon: -46.65 });
  assert.equal(urls.some((u) => u.includes("tomtom")), false);
});

test("roteador: TomTom e OSRM fora devolve null", async () => {
  const f = (async () => resposta({}, 500)) as typeof fetch;
  assert.equal(await new Roteador("chave", f).rota({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }), null);
});

test("geocodificador: consultas concorrentes são serializadas e respeitam 1,1 s", async () => {
  const urls: string[] = [];
  const esperas: number[] = [];
  const f = (async (u: string) => (urls.push(u), resposta([{ lat: "1", lon: "2" }]))) as typeof fetch;
  const g = new Geocodificador(cacheMemoria(), f, async (ms) => void esperas.push(ms), () => 0);
  await Promise.all([g.localizar("A"), g.localizar("B")]);
  assert.deepEqual(esperas, [1100]);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /q=A(&|$)/);
  assert.match(urls[1], /q=B(&|$)/);
});

test("geocodificador: erro HTTP devolve null, não repete por 5 min e tenta de novo depois", async () => {
  let n = 0;
  const f = (async () => (n++, resposta({}, 500))) as typeof fetch;
  let agora = 0;
  const g = new Geocodificador(cacheMemoria(), f, async () => undefined, () => agora);
  assert.equal(await g.localizar("Rua Com Erro 1"), null);
  agora = 4 * 60_000;
  assert.equal(await g.localizar("Rua Com Erro 1"), null);
  assert.equal(n, 1);
  agora = 6 * 60_000;
  assert.equal(await g.localizar("Rua Com Erro 1"), null);
  assert.equal(n, 2);
});
