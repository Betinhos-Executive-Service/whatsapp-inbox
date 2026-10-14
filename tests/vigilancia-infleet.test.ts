import assert from "node:assert/strict";
import { test } from "node:test";
import { InfleetCliente, normalizarPlaca } from "../server/vigilancia/infleet.ts";

const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const veiculo = (plate: string, over: Record<string, unknown> = {}) => ({
  id: plate, plate, displayName: plate, driver: { id: "d", name: "Beto" },
  location: { latitude: -23.6, longitude: -46.7, address: "Rod. Castello Branco", speed: 60, ignition: true, fixTime: "2026-10-14T15:59:00Z" }, ...over,
});

test("normalizarPlaca: sem hífen, espaços e em maiúsculas", () => {
  assert.equal(normalizarPlaca("abc-1d23"), "ABC1D23");
  assert.equal(normalizarPlaca(" ABC 1D23 "), "ABC1D23");
  assert.equal(normalizarPlaca(null), "");
});

test("frota: pagina de 100 em 100 e indexa por placa normalizada", async () => {
  const pedidos: { query: string; variables: Record<string, unknown>; auth: string }[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    pedidos.push({ ...b, auth: (init.headers as Record<string, string>).Authorization });
    const offset = b.variables.offset as number;
    const lista = offset === 0 ? Array.from({ length: 100 }, (_, i) => veiculo(`AAA${String(i).padStart(4, "0")}`)) : [veiculo("ABC-1D23"), veiculo("SEM0000", { location: null }), veiculo("HORA000", { location: { latitude: -23.6, longitude: -46.7, address: null, speed: 0, ignition: false, fixTime: "x" } })];
    return resposta({ data: { listVehicles: lista } });
  }) as typeof fetch;
  const frota = await new InfleetCliente("tok", f).frota();
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[0].auth, "Bearer tok");
  assert.match(pedidos[0].query, /listVehicles\(limit:100, offset:\$offset/);
  assert.equal(frota.size, 101);
  assert.equal(frota.has("HORA000"), false);
  assert.deepEqual(frota.get("ABC1D23"), { placa: "ABC-1D23", lat: -23.6, lon: -46.7, endereco: "Rod. Castello Branco", velocidadeKmh: 60, ignicao: true, fixAt: Date.UTC(2026, 9, 14, 15, 59), motorista: "Beto" });
  assert.equal(frota.has("SEM0000"), false);
});

test("frota: para em 50 páginas quando a API não encerra a paginação", async () => {
  let chamadas = 0;
  const f = (async () => {
    chamadas++;
    return resposta({ data: { listVehicles: Array.from({ length: 100 }, (_, i) => veiculo(`ZZZ${chamadas}${String(i).padStart(4, "0")}`)) } });
  }) as typeof fetch;
  await assert.rejects(new InfleetCliente("tok", f).frota(), /paginação/);
  assert.equal(chamadas, 50);
});

test("frota: erro GraphQL vira exceção", async () => {
  const f = (async () => resposta({ errors: [{ message: "unauthorized" }] })) as typeof fetch;
  await assert.rejects(new InfleetCliente("tok", f).frota(), /Infleet HTTP 200/);
});
