import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { aplicarPatch, lerConfig } from "../server/vigilancia/index.ts";

const TODOS = { vigilancia_grupo_jid: "g@g.us", dv_environment_url: "https://org.crm2.dynamics.com/", dv_tenant_id: "t", dv_client_id: "c", dv_client_secret: "s", infleet_token: "i" };

test("lerConfig: lista o que falta e usa padrões", () => {
  const s = new Store(":memory:");
  const c = lerConfig((k) => s.getSetting(k), {});
  assert.equal(c.config, null);
  assert.deepEqual(c.faltando, ["Grupo do WhatsApp", "URL do Dataverse", "Tenant ID", "Client ID", "Client Secret", "Token da Infleet"]);
  assert.deepEqual(c.valores, { grupoJid: null, margemMin: 10, janelaMin: 120, cadenciaMin: 5, ensaio: false });
});

test("lerConfig: completa pelas settings, aceita env como alternativa e tira a barra final da URL", () => {
  const s = new Store(":memory:");
  for (const [k, v] of Object.entries(TODOS)) s.setSetting(k, v);
  s.setSetting("vigilancia_margem_min", "15");
  s.setSetting("vigilancia_ativa", "1");
  const c = lerConfig((k) => s.getSetting(k), {});
  assert.deepEqual(c.faltando, []);
  assert.equal(c.ativa, true);
  assert.equal(c.config?.regras.margemMin, 15);
  assert.equal(c.config?.grupoJid, "g@g.us");
  assert.equal(c.dataverse?.url, "https://org.crm2.dynamics.com");
  assert.equal(c.tomtomKey, null);
  const env = lerConfig((k) => (k === "vigilancia_grupo_jid" ? "g@g.us" : null), { DV_ENVIRONMENT_URL: "https://x.crm.dynamics.com", DV_TENANT_ID: "t", DV_CLIENT_ID: "c", DV_CLIENT_SECRET: "s", INFLEET_TOKEN: "i", TOMTOM_KEY: "tt" });
  assert.deepEqual(env.faltando, []);
  assert.equal(env.tomtomKey, "tt");
});

test("aplicarPatch: grava só o que veio e apaga com null", () => {
  const s = new Store(":memory:");
  aplicarPatch((k, v) => s.setSetting(k, v), { ativa: true, grupoJid: "g@g.us", margemMin: 12, dvClientSecret: "segredo", tomtomKey: null });
  assert.equal(s.getSetting("vigilancia_ativa"), "1");
  assert.equal(s.getSetting("vigilancia_grupo_jid"), "g@g.us");
  assert.equal(s.getSetting("vigilancia_margem_min"), "12");
  assert.equal(s.getSetting("dv_client_secret"), "segredo");
  assert.equal(s.getSetting("tomtom_key"), null);
  assert.equal(s.getSetting("vigilancia_janela_min"), null);
});
