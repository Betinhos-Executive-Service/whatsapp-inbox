import assert from "node:assert/strict";
import { test } from "node:test";
import { fillQuickReply, quickQuery } from "../ui/quick-text.ts";

test("resposta rápida: atalho no começo do campo e {nome} pelo primeiro nome", () => {
  assert.equal(quickQuery("/pi"), "pi");
  assert.equal(quickQuery("/"), "");
  assert.equal(quickQuery("oi /pix"), null);
  assert.equal(fillQuickReply("Olá, {nome}!", "Ana Souza"), "Olá, Ana!");
  assert.equal(fillQuickReply("Olá, {nome}!", "+5511999990000"), "Olá!");
});
