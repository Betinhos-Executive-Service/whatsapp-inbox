// Registro das contas de WhatsApp do app desktop: cada conta é uma instância separada
// (servidor, banco, auth e configurações próprios) dentro da mesma janela. Sem Electron, para testar.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Account = { id: string; name: string; dataDir: string; createdAt: number };
export type Registry = { accounts: Account[]; active: string };

export const MAX_ACCOUNTS = 9;
const MAX_NAME = 40;
const FILE = "accounts.json";

/** Nome limpo e curto; vazio vira o padrão. */
export function cleanName(name: string, fallback: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return clean || fallback;
}

/**
 * Lê o registro. Sem arquivo (instalação de antes das várias contas), a conta principal
 * aponta para a pasta `data` de sempre: nada é movido e as conversas continuam lá.
 */
export function loadAccounts(userData: string): Registry {
  const file = join(userData, FILE);
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Registry>;
      const accounts = (raw.accounts ?? []).filter(
        (a): a is Account => !!a && typeof a.id === "string" && typeof a.name === "string" && typeof a.dataDir === "string",
      );
      if (accounts.length) {
        const active = accounts.some((a) => a.id === raw.active) ? raw.active! : accounts[0].id;
        return { accounts, active };
      }
    } catch {
      // arquivo corrompido: recomeça pela conta principal, que nunca perde os dados
    }
  }
  const registry: Registry = {
    accounts: [{ id: "principal", name: "Principal", dataDir: join(userData, "data"), createdAt: Date.now() }],
    active: "principal",
  };
  saveAccounts(userData, registry);
  return registry;
}

/** Escrita atômica: um app fechado no meio nunca deixa o registro pela metade. */
export function saveAccounts(userData: string, registry: Registry): void {
  mkdirSync(userData, { recursive: true });
  const file = join(userData, FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2));
  renameSync(tmp, file);
}

export function addAccount(userData: string, registry: Registry, name: string): { registry: Registry; account: Account } {
  if (registry.accounts.length >= MAX_ACCOUNTS) throw new Error(`Limite de ${MAX_ACCOUNTS} contas.`);
  let id: string;
  do id = randomBytes(4).toString("hex");
  while (registry.accounts.some((a) => a.id === id));
  const account: Account = {
    id,
    name: cleanName(name, `Conta ${registry.accounts.length + 1}`),
    dataDir: join(userData, "accounts", id),
    createdAt: Date.now(),
  };
  return { registry: { accounts: [...registry.accounts, account], active: id }, account };
}

export function renameAccount(registry: Registry, id: string, name: string): Registry {
  return {
    ...registry,
    accounts: registry.accounts.map((a) => (a.id === id ? { ...a, name: cleanName(name, a.name) } : a)),
  };
}

/** A última conta não sai: o app sempre tem pelo menos uma. */
export function removeAccount(registry: Registry, id: string): Registry {
  if (registry.accounts.length <= 1) throw new Error("O app precisa de pelo menos uma conta.");
  const accounts = registry.accounts.filter((a) => a.id !== id);
  return { accounts, active: registry.active === id ? accounts[0].id : registry.active };
}

export function setActive(registry: Registry, id: string): Registry {
  return registry.accounts.some((a) => a.id === id) ? { ...registry, active: id } : registry;
}

/** A pasta só é apagada se for de uma conta adicionada (dentro de `accounts/`), nunca a `data` original. */
export function isRemovableDir(userData: string, account: Account): boolean {
  return account.dataDir === join(userData, "accounts", account.id);
}
