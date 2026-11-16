import assert from "node:assert/strict";
import { test } from "node:test";
import type { SignalDataSet, SignalKeyStore } from "@whiskeysockets/baileys";
import { caseSafeAppStateKeys } from "../server/app-state-keys.ts";

/** Pasta de chaves como no NTFS do Windows: o nome do arquivo não diferencia maiúscula. */
function windowsFolder() {
  const files = new Map<string, unknown>();
  const name = (type: string, id: string) => `${type}-${id}`.toLowerCase();
  const store: SignalKeyStore = {
    get: (type, ids) => Object.fromEntries(ids.map((id) => [id, files.get(name(type, id))]).filter(([, v]) => v)),
    set: (data: SignalDataSet) => {
      for (const [type, entries] of Object.entries(data)) for (const [id, v] of Object.entries(entries ?? {})) files.set(name(type, id), v);
    },
  };
  return { store, files };
}

const key = (n: number) => ({ keyData: new Uint8Array([n]) });

test("chaves que diferem só por maiúscula não se sobrescrevem no Windows", async () => {
  const { store } = windowsFolder();
  // Sem o adaptador, a segunda chave apaga a primeira.
  await store.set({ "app-state-sync-key": { AAAAAEib: key(1), AAAAAEiB: key(2) } });
  assert.deepEqual((await store.get("app-state-sync-key", ["AAAAAEib"])).AAAAAEib, key(2));

  const safe = caseSafeAppStateKeys(windowsFolder().store, () => undefined, false);
  await safe.set({ "app-state-sync-key": { AAAAAEib: key(1), AAAAAEiB: key(2) } });
  const got = await safe.get("app-state-sync-key", ["AAAAAEib", "AAAAAEiB"]);
  assert.deepEqual(got.AAAAAEib, key(1));
  assert.deepEqual(got.AAAAAEiB, key(2));
});

test("chave ausente vai para o pedido ao celular; outros tipos passam direto", async () => {
  const { store } = windowsFolder();
  const missing: string[][] = [];
  const safe = caseSafeAppStateKeys(store, (ids) => missing.push(ids), false);
  await store.set({ "app-state-sync-key": { AAAAAEjK: key(9) } }); // nome antigo, não confiável no Windows
  await store.set({ "pre-key": { "1": { public: new Uint8Array(), private: new Uint8Array() } } });
  assert.deepEqual(await safe.get("app-state-sync-key", ["AAAAAEjK"]), {});
  assert.deepEqual(missing, [["AAAAAEjK"]]);
  assert.ok((await safe.get("pre-key", ["1"]))["1"]);
});

test("no Linux a chave no nome antigo migra para o novo", async () => {
  const { store, files } = windowsFolder();
  await store.set({ "app-state-sync-key": { AAAAAEjK: key(9) } });
  const missing: string[][] = [];
  const safe = caseSafeAppStateKeys(store, (ids) => missing.push(ids), true);
  assert.deepEqual((await safe.get("app-state-sync-key", ["AAAAAEjK"])).AAAAAEjK, key(9));
  assert.deepEqual(missing, []);
  assert.ok(files.has("app-state-sync-key-hex-0000000048ca"));
});
