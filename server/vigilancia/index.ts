import type { Store } from "../db.ts";
import { DataverseCliente, type DataverseConfig } from "./dataverse.ts";
import { Geocodificador, Roteador } from "./geo.ts";
import { InfleetCliente } from "./infleet.ts";
import { Vigilancia, type ConfigVigilancia, type DepsVigilancia, type ResultadoCiclo } from "./job.ts";
import { Redator } from "./mensagem.ts";
import { CONFIG_REGRAS_PADRAO } from "./tipos.ts";

export type { ResultadoCiclo } from "./job.ts";

export type StatusVigilancia = {
  ativa: boolean;
  emExecucao: boolean;
  faltando: string[];
  grupoJid: string | null;
  grupos: { jid: string; name: string }[];
  margemMin: number;
  janelaMin: number;
  cadenciaMin: number;
  ensaio: boolean;
  segredos: { anthropic: boolean; dataverse: boolean; infleet: boolean; tomtom: boolean };
  ultimo: ResultadoCiclo | null;
};

export type PatchVigilancia = {
  ativa?: boolean;
  grupoJid?: string | null;
  margemMin?: number;
  janelaMin?: number;
  cadenciaMin?: number;
  ensaio?: boolean;
  dvEnvironmentUrl?: string | null;
  dvTenantId?: string | null;
  dvClientId?: string | null;
  dvClientSecret?: string | null;
  infleetToken?: string | null;
  tomtomKey?: string | null;
};

const PADRAO = { margemMin: 10, janelaMin: 120, cadenciaMin: 5 };
const numero = (v: string | null, padrao: number) => (v !== null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : padrao);

export function lerConfig(get: (k: string) => string | null, env: NodeJS.ProcessEnv) {
  const ou = (chave: string, envNome: string) => env[envNome] || get(chave) || null;
  const grupoJid = get("vigilancia_grupo_jid");
  const url = (ou("dv_environment_url", "DV_ENVIRONMENT_URL") ?? "").replace(/\/+$/, "") || null;
  const tenantId = ou("dv_tenant_id", "DV_TENANT_ID");
  const clientId = ou("dv_client_id", "DV_CLIENT_ID");
  const clientSecret = ou("dv_client_secret", "DV_CLIENT_SECRET");
  const infleetToken = ou("infleet_token", "INFLEET_TOKEN");
  const tomtomKey = ou("tomtom_key", "TOMTOM_KEY");
  const faltando = [
    [!grupoJid, "Grupo do WhatsApp"], [!url, "URL do Dataverse"], [!tenantId, "Tenant ID"], [!clientId, "Client ID"], [!clientSecret, "Client Secret"], [!infleetToken, "Token da Infleet"],
  ].filter(([falta]) => falta).map(([, nome]) => nome as string);
  const valores = {
    grupoJid,
    margemMin: numero(get("vigilancia_margem_min"), PADRAO.margemMin),
    janelaMin: numero(get("vigilancia_janela_min"), PADRAO.janelaMin),
    cadenciaMin: numero(get("vigilancia_cadencia_min"), PADRAO.cadenciaMin),
    ensaio: get("vigilancia_ensaio") === "1",
  };
  const completo = faltando.length === 0;
  const config: ConfigVigilancia | null = completo
    ? { grupoJid: grupoJid!, janelaMin: valores.janelaMin, cadenciaMin: valores.cadenciaMin, ensaio: valores.ensaio, regras: { ...CONFIG_REGRAS_PADRAO, margemMin: valores.margemMin } }
    : null;
  const dataverse: DataverseConfig | null = url && tenantId && clientId && clientSecret ? { url, tenantId, clientId, clientSecret } : null;
  return { config, faltando, dataverse, infleetToken, tomtomKey, ativa: get("vigilancia_ativa") === "1", valores };
}

export function aplicarPatch(set: (k: string, v: string | null) => void, p: PatchVigilancia): void {
  const bool = (v: boolean) => (v ? "1" : "0");
  if (p.ativa !== undefined) set("vigilancia_ativa", bool(p.ativa));
  if (p.grupoJid !== undefined) set("vigilancia_grupo_jid", p.grupoJid);
  if (p.margemMin !== undefined) set("vigilancia_margem_min", String(p.margemMin));
  if (p.janelaMin !== undefined) set("vigilancia_janela_min", String(p.janelaMin));
  if (p.cadenciaMin !== undefined) set("vigilancia_cadencia_min", String(p.cadenciaMin));
  if (p.ensaio !== undefined) set("vigilancia_ensaio", bool(p.ensaio));
  if (p.dvEnvironmentUrl !== undefined) set("dv_environment_url", p.dvEnvironmentUrl);
  if (p.dvTenantId !== undefined) set("dv_tenant_id", p.dvTenantId);
  if (p.dvClientId !== undefined) set("dv_client_id", p.dvClientId);
  if (p.dvClientSecret !== undefined) set("dv_client_secret", p.dvClientSecret);
  if (p.infleetToken !== undefined) set("infleet_token", p.infleetToken);
  if (p.tomtomKey !== undefined) set("tomtom_key", p.tomtomKey);
}

/** Monta o job com as dependências reais; null quando falta configuração. */
export function criarVigilancia(args: {
  store: Store;
  env: NodeJS.ProcessEnv;
  anthropicKey: () => string | null | undefined;
  enviar: DepsVigilancia["enviar"];
  registrarUso: DepsVigilancia["registrarUso"];
  log: DepsVigilancia["log"];
}): Vigilancia | null {
  const c = lerConfig((k) => args.store.getSetting(k), args.env);
  if (!c.config || !c.dataverse || !c.infleetToken) return null;
  return new Vigilancia(
    {
      dataverse: new DataverseCliente(c.dataverse),
      infleet: new InfleetCliente(c.infleetToken),
      geocodificador: new Geocodificador(args.store),
      roteador: new Roteador(c.tomtomKey),
      redator: new Redator(args.anthropicKey),
      estado: args.store,
      enviar: args.enviar,
      registrarUso: args.registrarUso,
      log: args.log,
    },
    c.config,
  );
}
