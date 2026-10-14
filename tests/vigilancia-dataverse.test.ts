import assert from "node:assert/strict";
import { test } from "node:test";
import { DataverseCliente, extrairEmbarque, montarConsultaOs } from "../server/vigilancia/dataverse.ts";

const CFG = { url: "https://org.crm2.dynamics.com", tenantId: "tenant", clientId: "cid", clientSecret: "segredo" };
const AGORA = Date.UTC(2026, 9, 14, 16, 0);
const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("extrairEmbarque: primeira linha sem o número e o nome do passageiro", () => {
  assert.equal(extrairEmbarque("1. Gabriela - Hotel Radisson Vila Olímpia\n2. João - Rua X, 10"), "Hotel Radisson Vila Olímpia");
  assert.equal(extrairEmbarque("1. Alvadi - Aeroporto de Guarulhos - Voo LA 8127"), "Aeroporto de Guarulhos - Voo LA 8127");
  assert.equal(extrairEmbarque("Av. Paulista, 1000"), "Av. Paulista, 1000");
  assert.equal(extrairEmbarque("  "), null);
  assert.equal(extrairEmbarque(null), null);
});

test("montarConsultaOs: janela, status excluídos e expands", () => {
  const q = montarConsultaOs(AGORA, 120);
  assert.match(q, /^cr40f_reservadeveculos\?/);
  assert.match(q, /cr40f_dataehorriodesada ge 2026-10-14T16:00:00\.000Z and cr40f_dataehorriodesada lt 2026-10-14T18:00:00\.000Z/);
  assert.match(q, /cr40f_status ne 202410002/);
  assert.match(q, /cr40f_status ne 202410010/);
  assert.match(q, /cr40f_status ne 202410008/);
  assert.match(q, /\$expand=cr40f_Motorista\(\$select=cr40f_nomecompleto,new_apelido\),cr40f_Cliente\(\$select=cr40f_nomedocliente\)/);
  assert.match(q, /\$orderby=cr40f_dataehorriodesada asc/);
});

test("DataverseCliente: pede token uma vez, consulta OS e veículos, monta OsVigiada", async () => {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.includes("login.microsoftonline.com/tenant/oauth2/v2.0/token")) return resposta({ access_token: "tok", expires_in: 3600 });
    if (url.includes("cr40f_reservadeveculos")) {
      return resposta({
        value: [
          { cr40f_reservadeveculosid: "os-1", cr40f_id: "OS-1234", cr40f_dataehorriodesada: "2026-10-14T17:00:00Z", cr40f_endereodesada: "1. Fulano - Av. Paulista, 1000", cr40f_passageirosetelefonedecontato: "Fulano (11 9999)", _cr40f_veiculo_value: "v-1", cr40f_Motorista: { cr40f_nomecompleto: "Roberto Silva", new_apelido: "Beto" }, cr40f_Cliente: { cr40f_nomedocliente: "Acme" } },
          { cr40f_reservadeveculosid: "os-2", cr40f_id: "OS-1235", cr40f_dataehorriodesada: "2026-10-14T17:30:00Z", cr40f_endereodesada: null, cr40f_passageirosetelefonedecontato: null, _cr40f_veiculo_value: null, cr40f_Motorista: null, cr40f_Cliente: null },
        ],
      });
    }
    if (url.includes("cr40f_veiculos")) return resposta({ value: [{ cr40f_veiculosid: "v-1", cr40f_placa: "ABC-1D23" }] });
    return resposta({}, 404);
  }) as typeof fetch;
  const dv = new DataverseCliente(CFG, f, () => AGORA);
  const lista = await dv.osNaJanela(AGORA, 120);
  assert.deepEqual(lista, [
    { id: "os-1", numero: "OS-1234", saidaAt: Date.UTC(2026, 9, 14, 17, 0), endereco: "Av. Paulista, 1000", cliente: "Acme", passageiros: "Fulano (11 9999)", motorista: "Beto", placa: "ABC-1D23" },
    { id: "os-2", numero: "OS-1235", saidaAt: Date.UTC(2026, 9, 14, 17, 30), endereco: null, cliente: null, passageiros: null, motorista: null, placa: null },
  ]);
  const token = chamadas[0];
  assert.match(String(token.init?.body), /grant_type=client_credentials/);
  assert.match(String(token.init?.body), /scope=https%3A%2F%2Forg\.crm2\.dynamics\.com%2F\.default/);
  const os = chamadas.find((c) => c.url.includes("cr40f_reservadeveculos"))!;
  assert.equal((os.init?.headers as Record<string, string>).authorization, "Bearer tok");
  assert.match(os.url, /^https:\/\/org\.crm2\.dynamics\.com\/api\/data\/v9\.2\/cr40f_reservadeveculos\?/);
  await dv.osNaJanela(AGORA + 60_000, 120);
  assert.equal(chamadas.filter((c) => c.url.includes("oauth2")).length, 1);
});

test("DataverseCliente: erro HTTP vira exceção com status, sem o corpo inteiro", async () => {
  const f = (async (url: string) => (url.includes("oauth2") ? resposta({ access_token: "tok", expires_in: 3600 }) : resposta({ error: { message: "x".repeat(2000) } }, 403))) as typeof fetch;
  await assert.rejects(new DataverseCliente(CFG, f).osNaJanela(AGORA, 120), /Dataverse HTTP 403/);
});
