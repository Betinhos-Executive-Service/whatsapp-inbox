import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSummary } from "../server/ai.ts";

test("resumo da IA local: lê o formato pedido e tolera variações", () => {
  const s = parseSummary("RESUMO: Ana quer carro amanhã às 7h para Guarulhos.\nPEDIDO: valor para 3 pessoas\nPROXIMO PASSO: enviar cotação");
  assert.equal(s.pedido, "valor para 3 pessoas");
  assert.equal(s.proximoPasso, "enviar cotação");
  assert.equal(parseSummary("texto solto sem rótulos").resumo, "texto solto sem rótulos");
});
