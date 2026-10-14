import type { Coord, Rota } from "./tipos.ts";

export type GeocacheStore = { geocacheGet(endereco: string): Coord | null; geocacheSet(endereco: string, coord: Coord, at: number): void };

const UA = "betinhos-whatsapp-inbox-vigilancia/1.0";
const INTERVALO_NOMINATIM_MS = 1100;
const REPETIR_FALHA_MS = 60 * 60_000;
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

/** Nominatim (1 req/s) com cache permanente dos acertos e memória de 60 min das falhas. */
export class Geocodificador {
  private readonly falhas = new Map<string, number>();
  private ultimaConsultaAt = -Infinity;
  private readonly cache: GeocacheStore;
  private readonly fetchFn: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly agora: () => number;

  constructor(cache: GeocacheStore, fetchFn: typeof fetch = fetch, esperar: (ms: number) => Promise<void> = dormir, agora: () => number = Date.now) {
    this.cache = cache;
    this.fetchFn = fetchFn;
    this.esperar = esperar;
    this.agora = agora;
  }

  async localizar(endereco: string): Promise<Coord | null> {
    const chave = endereco.trim().replace(/\s+/g, " ");
    if (!chave) return null;
    const guardado = this.cache.geocacheGet(chave);
    if (guardado) return guardado;
    const falhouEm = this.falhas.get(chave);
    if (falhouEm !== undefined && this.agora() - falhouEm < REPETIR_FALHA_MS) return null;
    const desdeUltima = this.agora() - this.ultimaConsultaAt;
    if (desdeUltima < INTERVALO_NOMINATIM_MS) await this.esperar(INTERVALO_NOMINATIM_MS);
    this.ultimaConsultaAt = this.agora();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(chave)}`;
    const res = await this.fetchFn(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const [hit] = (await res.json()) as { lat: string; lon: string }[];
    if (!hit) {
      this.falhas.set(chave, this.agora());
      return null;
    }
    const coord = { lat: Number(hit.lat), lon: Number(hit.lon) };
    this.cache.geocacheSet(chave, coord, this.agora());
    return coord;
  }
}

/** TomTom (trânsito ao vivo) quando há chave; OSRM público (sem trânsito) de reserva. */
export class Roteador {
  private readonly tomtomKey: string | null;
  private readonly fetchFn: typeof fetch;

  constructor(tomtomKey: string | null, fetchFn: typeof fetch = fetch) {
    this.tomtomKey = tomtomKey;
    this.fetchFn = fetchFn;
  }

  async rota(origem: Coord, destino: Coord): Promise<Rota | null> {
    if (this.tomtomKey) {
      try {
        return await this.tomtom(origem, destino, this.tomtomKey);
      } catch {
        // cai no OSRM
      }
    }
    try {
      return await this.osrm(origem, destino);
    } catch {
      return null;
    }
  }

  private async tomtom(o: Coord, d: Coord, chave: string): Promise<Rota> {
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${o.lat},${o.lon}:${d.lat},${d.lon}/json?key=${encodeURIComponent(chave)}&traffic=true&travelMode=car&routeRepresentation=summaryOnly`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
    const r = ((await res.json()) as { routes?: { summary: { lengthInMeters: number; travelTimeInSeconds: number } }[] }).routes?.[0];
    if (!r) throw new Error("TomTom sem rota");
    return { minutos: Math.round(r.summary.travelTimeInSeconds / 60), km: Math.round(r.summary.lengthInMeters / 100) / 10, semTransito: false };
  }

  private async osrm(o: Coord, d: Coord): Promise<Rota> {
    const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false`;
    const res = await this.fetchFn(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const j = (await res.json()) as { code: string; routes?: { distance: number; duration: number }[] };
    const r = j.code === "Ok" ? j.routes?.[0] : undefined;
    if (!r) throw new Error("OSRM sem rota");
    return { minutos: Math.round(r.duration / 60), km: Math.round(r.distance / 100) / 10, semTransito: true };
  }
}
