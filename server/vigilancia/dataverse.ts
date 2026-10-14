import type { OsVigiada } from "./tipos.ts";

export type DataverseConfig = { url: string; tenantId: string; clientId: string; clientSecret: string };

const STATUS_FORA = [202410002, 202410010, 202410008]; // Cancelado, Cancelado com Ressalvas, Concluído
const SELECT_OS = "cr40f_reservadeveculosid,cr40f_id,cr40f_dataehorriodesada,cr40f_endereodesada,cr40f_passageirosetelefonedecontato,cr40f_status,_cr40f_veiculo_value";
const EXPAND_OS = "cr40f_Motorista($select=cr40f_nomecompleto,new_apelido),cr40f_Cliente($select=cr40f_nomedocliente)";

type LinhaOs = {
  cr40f_reservadeveculosid: string;
  cr40f_id: string | null;
  cr40f_dataehorriodesada: string;
  cr40f_endereodesada: string | null;
  cr40f_passageirosetelefonedecontato: string | null;
  _cr40f_veiculo_value: string | null;
  cr40f_Motorista: { cr40f_nomecompleto: string | null; new_apelido: string | null } | null;
  cr40f_Cliente: { cr40f_nomedocliente: string | null } | null;
};
type LinhaVeiculo = { cr40f_veiculosid: string; cr40f_placa: string | null };

/** Primeira linha de `cr40f_endereodesada` sem o `N. Nome - ` do passageiro. */
export function extrairEmbarque(texto: string | null): string | null {
  const linha = (texto ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!linha) return null;
  const prefixo = /^\d+\.\s*/.exec(linha);
  if (!prefixo) return linha;
  const semNumero = linha.slice(prefixo[0].length);
  const sep = semNumero.indexOf(" - ");
  return (sep >= 0 ? semNumero.slice(sep + 3) : semNumero).trim() || null;
}

export function montarConsultaOs(agora: number, janelaMin: number): string {
  const ini = new Date(agora).toISOString();
  const fim = new Date(agora + janelaMin * 60_000).toISOString();
  const filtro = [`cr40f_dataehorriodesada ge ${ini}`, `cr40f_dataehorriodesada lt ${fim}`, ...STATUS_FORA.map((s) => `cr40f_status ne ${s}`)].join(" and ");
  return `cr40f_reservadeveculos?$select=${SELECT_OS}&$expand=${EXPAND_OS}&$filter=${filtro}&$orderby=cr40f_dataehorriodesada asc`;
}

export class DataverseCliente {
  private readonly cfg: DataverseConfig;
  private readonly fetchFn: typeof fetch;
  private readonly agora: () => number;
  private tokenCache: { valor: string; expiraAt: number } | null = null;

  constructor(cfg: DataverseConfig, fetchFn: typeof fetch = fetch, agora: () => number = Date.now) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
    this.agora = agora;
  }

  async osNaJanela(agora: number, janelaMin: number): Promise<OsVigiada[]> {
    const linhas = await this.get<LinhaOs>(montarConsultaOs(agora, janelaMin));
    const idsVeiculo = [...new Set(linhas.map((l) => l._cr40f_veiculo_value).filter((v): v is string => !!v))];
    const placas = new Map<string, string | null>();
    if (idsVeiculo.length) {
      const filtro = idsVeiculo.map((id) => `cr40f_veiculosid eq ${id}`).join(" or ");
      for (const v of await this.get<LinhaVeiculo>(`cr40f_veiculos?$select=cr40f_veiculosid,cr40f_placa&$filter=${filtro}`)) placas.set(v.cr40f_veiculosid, v.cr40f_placa);
    }
    return linhas.map((l) => ({
      id: l.cr40f_reservadeveculosid,
      numero: l.cr40f_id,
      saidaAt: new Date(l.cr40f_dataehorriodesada).getTime(),
      endereco: extrairEmbarque(l.cr40f_endereodesada),
      cliente: l.cr40f_Cliente?.cr40f_nomedocliente ?? null,
      passageiros: l.cr40f_passageirosetelefonedecontato,
      motorista: l.cr40f_Motorista ? (l.cr40f_Motorista.new_apelido || l.cr40f_Motorista.cr40f_nomecompleto) : null,
      placa: (l._cr40f_veiculo_value && placas.get(l._cr40f_veiculo_value)) || null,
    }));
  }

  private async get<T>(consulta: string): Promise<T[]> {
    const token = await this.token();
    const res = await this.fetchFn(`${this.cfg.url}/api/data/v9.2/${consulta}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json", "odata-maxversion": "4.0", "odata-version": "4.0" },
    });
    if (!res.ok) throw new Error(`Dataverse HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { value: T[] }).value;
  }

  private async token(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiraAt > this.agora()) return this.tokenCache.valor;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: `${this.cfg.url}/.default` });
    const res = await this.fetchFn(`https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!res.ok) throw new Error(`Entra ID HTTP ${res.status}: token do Dataverse recusado`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = { valor: j.access_token, expiraAt: this.agora() + (j.expires_in - 60) * 1000 };
    return j.access_token;
  }
}
