import type { Coord, Rota } from "./tipos.ts";

export type GeocacheStore = { geocacheGet(endereco: string): Coord | null; geocacheSet(endereco: string, coord: Coord, at: number): void };

const UA = "betinhos-whatsapp-inbox-vigilancia/1.0";
const INTERVALO_NOMINATIM_MS = 1100;
const REPETIR_FALHA_MS = 60 * 60_000;
const REPETIR_ERRO_MS = 5 * 60_000;
const TIMEOUT_MS = 15_000;
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

/**
 * Nominatim (1 req/s) com cache permanente dos acertos e memória das falhas (60 min sem resultado, 5 min em erro).
 * Endereço com ` - ` sem resultado tenta de novo só com o texto antes do último ` - `
 * (ex.: "Aeroporto de Guarulhos - Voo LA 8127" → "Aeroporto de Guarulhos"); o acerto fica no cache com a chave original.
 */
export class Geocodificador {
  /** Chave do endereço -> instante (ms) até o qual não deve ser consultado de novo. */
  private readonly falhas = new Map<string, number>();
  private ultimaConsultaAt = -Infinity;
  private fila: Promise<unknown> = Promise.resolve();
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
    const ate = this.falhas.get(chave);
    if (ate !== undefined && this.agora() < ate) return null;
    const trabalho = this.fila.then(() => this.consultar(chave));
    this.fila = trabalho.catch(() => undefined);
    return trabalho;
  }

  /** Executa uma consulta por vez: a espera de 1,1 s vale entre todas as chamadas concorrentes. */
  private async consultar(chave: string): Promise<Coord | null> {
    const guardado = this.cache.geocacheGet(chave);
    if (guardado) return guardado;
    const ate = this.falhas.get(chave);
    if (ate !== undefined && this.agora() < ate) return null;
    let coord = await this.buscar(chave);
    const sep = chave.lastIndexOf(" - ");
    const reduzido = sep > 0 ? chave.slice(0, sep).trim() : "";
    if (coord === null && reduzido) coord = await this.buscar(reduzido);
    if (coord === "erro") {
      this.falhas.set(chave, this.agora() + REPETIR_ERRO_MS);
      return null;
    }
    if (!coord) {
      this.falhas.set(chave, this.agora() + REPETIR_FALHA_MS);
      return null;
    }
    this.cache.geocacheSet(chave, coord, this.agora());
    return coord;
  }

  /** Uma chamada à Nominatim respeitando 1,1 s desde a anterior: coordenada, null (sem resultado) ou "erro". */
  private async buscar(texto: string): Promise<Coord | null | "erro"> {
    const desdeUltima = this.agora() - this.ultimaConsultaAt;
    if (desdeUltima < INTERVALO_NOMINATIM_MS) await this.esperar(INTERVALO_NOMINATIM_MS);
    this.ultimaConsultaAt = this.agora();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(texto)}`;
    let hit: { lat: string; lon: string } | undefined;
    try {
      const res = await this.fetchFn(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json)) throw new Error("Nominatim JSON inesperado");
      hit = json[0] as { lat: string; lon: string } | undefined;
    } catch {
      return "erro";
    }
    const coord = hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
    return coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon) ? coord : null;
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
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
    const r = ((await res.json()) as { routes?: { summary: { lengthInMeters: number; travelTimeInSeconds: number } }[] }).routes?.[0];
    if (!r) throw new Error("TomTom sem rota");
    return { minutos: Math.round(r.summary.travelTimeInSeconds / 60), km: Math.round(r.summary.lengthInMeters / 100) / 10, semTransito: false };
  }

  private async osrm(o: Coord, d: Coord): Promise<Rota> {
    const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false`;
    const res = await this.fetchFn(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const j = (await res.json()) as { code: string; routes?: { distance: number; duration: number }[] };
    const r = j.code === "Ok" ? j.routes?.[0] : undefined;
    if (!r) throw new Error("OSRM sem rota");
    return { minutos: Math.round(r.duration / 60), km: Math.round(r.distance / 100) / 10, semTransito: true };
  }
}
