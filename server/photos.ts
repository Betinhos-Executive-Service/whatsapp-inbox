// Fotos de perfil: o WhatsApp só entrega uma URL temporária. A miniatura é baixada uma vez e
// fica em disco (pasta photos/); "sem foto" também fica registrado, para não perguntar de novo
// a cada vez que a lista aparece.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./db.ts";

/** Com foto: confere de novo em 3 dias. Sem foto (ou privada): em 1 dia. */
const FRESH_MS = 3 * 86_400_000;
const NONE_MS = 86_400_000;
/** Falha de rede ou limite do WhatsApp: espera 10 min antes de tentar a mesma foto. */
const RETRY_MS = 10 * 60_000;
const PARALLEL = 3;

export type PhotoSource = {
  /** null quando o WhatsApp não está conectado. */
  url: (jid: string, full: boolean) => Promise<string | null> | null;
};

const fileName = (jid: string) => `${jid.replace(/[^a-z0-9]/gi, "_")}.jpg`;

export class PhotoCache {
  private readonly dir: string;
  private readonly store: Store;
  private readonly source: PhotoSource;
  private readonly fetchImpl: typeof fetch;
  private readonly inflight = new Map<string, Promise<Buffer | null>>();
  private readonly failedAt = new Map<string, number>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(dir: string, store: Store, source: PhotoSource, fetchImpl: typeof fetch = fetch) {
    this.dir = dir;
    this.store = store;
    this.source = source;
    this.fetchImpl = fetchImpl;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= PARALLEL) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async download(url: string): Promise<Buffer> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async readCached(file: string | null): Promise<Buffer | null> {
    if (!file) return null;
    return readFile(join(this.dir, file)).catch(() => null);
  }

  /** Miniatura da foto (cache em disco). null = sem foto, privada ou indisponível agora. */
  async thumb(jid: string): Promise<Buffer | null> {
    const cached = this.store.getPhoto(jid);
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    if (cached && age < (cached.file ? FRESH_MS : NONE_MS)) {
      const body = await this.readCached(cached.file);
      if (body || !cached.file) return body;
    }
    const stale = () => this.readCached(cached?.file ?? null);
    if (Date.now() - (this.failedAt.get(jid) ?? 0) < RETRY_MS) return stale();
    let running = this.inflight.get(jid);
    if (!running) {
      running = this.slot(async () => {
        const pending = this.source.url(jid, false);
        if (!pending) return stale();
        try {
          const url = await pending;
          if (!url) {
            this.store.setPhoto(jid, null);
            return null;
          }
          const body = await this.download(url);
          await mkdir(this.dir, { recursive: true });
          await writeFile(join(this.dir, fileName(jid)), body);
          this.store.setPhoto(jid, fileName(jid));
          return body;
        } catch {
          this.failedAt.set(jid, Date.now());
          return stale();
        }
      }).finally(() => this.inflight.delete(jid));
      this.inflight.set(jid, running);
    }
    return running;
  }

  /** Foto em tamanho cheio, sem cache (só no perfil). */
  async full(jid: string): Promise<Buffer | null> {
    const pending = this.source.url(jid, true);
    const url = pending ? await pending : null;
    return url ? this.download(url) : this.thumb(jid);
  }
}
