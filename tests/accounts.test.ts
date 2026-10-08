import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addAccount, isRemovableDir, loadAccounts, MAX_ACCOUNTS, removeAccount, renameAccount, saveAccounts, setActive } from "../desktop/accounts.ts";
import { startApp } from "../server/app.ts";

const dir = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

test("instalação antiga: a conta principal aponta para a pasta data de sempre", () => {
  const userData = dir("wi-acc-");
  const reg = loadAccounts(userData);
  assert.equal(reg.accounts.length, 1);
  assert.equal(reg.accounts[0].dataDir, join(userData, "data"));
  assert.equal(reg.active, "principal");
  assert.ok(existsSync(join(userData, "accounts.json")));
  assert.equal(isRemovableDir(userData, reg.accounts[0]), false);
});

test("adicionar, renomear, ativar e remover", () => {
  const userData = dir("wi-acc-");
  let reg = loadAccounts(userData);
  const added = addAccount(userData, reg, "  Business  ");
  reg = added.registry;
  assert.equal(added.account.name, "Business");
  assert.equal(added.account.dataDir, join(userData, "accounts", added.account.id));
  assert.equal(reg.active, added.account.id);
  assert.ok(isRemovableDir(userData, added.account));

  reg = renameAccount(reg, added.account.id, "Empresa");
  assert.equal(reg.accounts[1].name, "Empresa");
  reg = renameAccount(reg, added.account.id, "   ");
  assert.equal(reg.accounts[1].name, "Empresa", "nome vazio mantém o anterior");

  reg = setActive(reg, "principal");
  assert.equal(reg.active, "principal");
  assert.equal(setActive(reg, "nao-existe").active, "principal");

  saveAccounts(userData, reg);
  assert.deepEqual(loadAccounts(userData), reg);

  reg = setActive(reg, added.account.id);
  reg = removeAccount(reg, added.account.id);
  assert.equal(reg.accounts.length, 1);
  assert.equal(reg.active, "principal");
  assert.throws(() => removeAccount(reg, "principal"));
});

test("nome padrão e limite de contas", () => {
  const userData = dir("wi-acc-");
  let reg = loadAccounts(userData);
  reg = addAccount(userData, reg, "").registry;
  assert.equal(reg.accounts[1].name, "Conta 2");
  while (reg.accounts.length < MAX_ACCOUNTS) reg = addAccount(userData, reg, "x").registry;
  assert.throws(() => addAccount(userData, reg, "y"));
});

test("registro corrompido volta para a conta principal sem tocar nos dados", () => {
  const userData = dir("wi-acc-");
  writeFileSync(join(userData, "accounts.json"), "{nao é json");
  const reg = loadAccounts(userData);
  assert.equal(reg.accounts[0].dataDir, join(userData, "data"));
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(userData, "accounts.json"), "utf8")));
});

test("copiar configurações entre contas: leva etiquetas e chaves, nunca o número", async () => {
  const a = await startApp({ port: 0, dataDir: dir("wi-acc-a-"), distDir: "dist", waDisabled: true });
  const b = await startApp({ port: 0, dataDir: dir("wi-acc-b-"), distDir: "dist", waDisabled: true });
  try {
    const snapshot = a.exportSettings();
    snapshot.settings.push(["account", "5511999999999"], ["groq_api_key", "gsk_teste"]);
    snapshot.labels = [{ name: "Cliente", description: "Cliente ativo" }];
    snapshot.quickReplies = [{ shortcut: "oi", text: "Olá!" }];
    b.importSettings(snapshot);
    const copied = b.exportSettings();
    assert.deepEqual(copied.labels, [{ name: "Cliente", description: "Cliente ativo" }]);
    assert.deepEqual(copied.quickReplies, [{ shortcut: "oi", text: "Olá!" }]);
    assert.ok(copied.settings.some(([k, v]) => k === "groq_api_key" && v === "gsk_teste"));
    assert.ok(!copied.settings.some(([k]) => k === "account"));
  } finally {
    await a.close();
    await b.close();
  }
});
