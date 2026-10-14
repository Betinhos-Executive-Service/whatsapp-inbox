import type { Posicao } from "./tipos.ts";

const ENDPOINT = "https://api.infleet.com.br/v1/graphql";
const CAMPOS = `id plate displayName driver { id name } location { latitude longitude address speed ignition fixTime }`;
const PAGINA = 100;
const MAX_PAGINAS = 50;
const TIMEOUT_MS = 15_000;

type Veiculo = {
  plate: string | null;
  driver: { name: string | null } | null;
  location: { latitude: number; longitude: number; address: string | null; speed: number | null; ignition: boolean | null; fixTime: string } | null;
};

export const normalizarPlaca = (s: string | null | undefined): string => (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();

export class InfleetCliente {
  private readonly token: string;
  private readonly fetchFn: typeof fetch;

  constructor(token: string, fetchFn: typeof fetch = fetch) {
    this.token = token;
    this.fetchFn = fetchFn;
  }

  /** Posição atual de toda a frota, indexada pela placa normalizada. Veículos sem posição ficam de fora. */
  async frota(): Promise<Map<string, Posicao>> {
    const frota = new Map<string, Posicao>();
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const d = await this.gql<{ listVehicles: Veiculo[] }>(`query($offset:Int){ listVehicles(limit:${PAGINA}, offset:$offset){ ${CAMPOS} } }`, { offset: pagina * PAGINA });
      for (const v of d.listVehicles) {
        const l = v.location;
        if (!v.plate || !l) continue;
        const fixAt = new Date(l.fixTime).getTime();
        if (Number.isNaN(fixAt)) continue;
        frota.set(normalizarPlaca(v.plate), {
          placa: v.plate, lat: l.latitude, lon: l.longitude, endereco: l.address, velocidadeKmh: l.speed ?? 0, ignicao: !!l.ignition, fixAt, motorista: v.driver?.name ?? null,
        });
      }
      if (d.listVehicles.length < PAGINA) return frota;
    }
    throw new Error("Infleet: paginação excedeu 50 páginas");
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
    if (!res.ok || body.errors || !body.data) throw new Error(`Infleet HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    return body.data;
  }
}
