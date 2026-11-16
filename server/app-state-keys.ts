import type { SignalDataTypeMap, SignalKeyStore } from "@whiskeysockets/baileys";

const TYPE = "app-state-sync-key";

/**
 * O Baileys grava cada chave de sincronização em "app-state-sync-key-<id em base64>.json", e há ids que diferem só
 * por maiúscula ("AAAAAEib" × "AAAAAEiB"). No Windows os dois nomes são o mesmo arquivo: uma chave sobrescreve a
 * outra e arquivar, fixar e marcar como não lida param de sincronizar com o celular, nos dois sentidos.
 * Em hex o nome não colide. No Linux o arquivo antigo é confiável e migra; no Windows pode estar trocado, então a
 * chave que faltar vai para `onMissing`, que a pede de novo ao celular.
 */
export function caseSafeAppStateKeys(
  keys: SignalKeyStore,
  onMissing: (ids: string[]) => void,
  readLegacy = process.platform === "linux",
): SignalKeyStore {
  const file = (id: string) => `hex-${Buffer.from(id, "base64").toString("hex")}`;
  return {
    ...keys,
    async get(type, ids) {
      if (type !== TYPE) return keys.get(type, ids);
      const stored = await keys.get(TYPE, ids.map(file));
      const found: { [id: string]: SignalDataTypeMap[typeof TYPE] } = {};
      for (const id of ids) if (stored[file(id)]) found[id] = stored[file(id)];
      let missing = ids.filter((id) => !found[id]);
      if (missing.length && readLegacy) {
        const legacy = await keys.get(TYPE, missing);
        const migrated = missing.filter((id) => legacy[id]);
        for (const id of migrated) found[id] = legacy[id];
        if (migrated.length) await keys.set({ [TYPE]: Object.fromEntries(migrated.map((id) => [file(id), legacy[id]])) });
        missing = missing.filter((id) => !found[id]);
      }
      if (missing.length) onMissing(missing);
      return found as { [id: string]: SignalDataTypeMap[typeof type] };
    },
    set(data) {
      const sync = data[TYPE];
      if (!sync) return keys.set(data);
      return keys.set({ ...data, [TYPE]: Object.fromEntries(Object.entries(sync).map(([id, value]) => [file(id), value])) });
    },
  };
}
