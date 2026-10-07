// Fotos de perfil para a notificação do Windows: um arquivo por conversa, válido por 24 h.
// "Sem foto" também fica guardado (arquivo .none) para não perguntar ao WhatsApp a cada mensagem.
import { createHash } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TTL = 24 * 60 * 60 * 1000;

export function avatarCache(
  dir: string,
  source: (jid: string) => Promise<string | null>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): (jid: string) => Promise<string | null> {
  const pending = new Map<string, Promise<string | null>>();
  const fresh = async (path: string) => {
    try {
      return now() - (await stat(path)).mtimeMs < TTL;
    } catch {
      return false;
    }
  };

  async function load(jid: string): Promise<string | null> {
    const key = createHash("sha1").update(jid).digest("hex").slice(0, 16);
    const photo = join(dir, `${key}.jpg`);
    const none = join(dir, `${key}.none`);
    if (await fresh(photo)) return photo;
    if (await fresh(none)) return null;
    try {
      // Fonte que lança (ex.: WhatsApp desconectado) não vira "sem foto": tenta de novo depois.
      const url = await source(jid);
      await mkdir(dir, { recursive: true });
      if (!url) {
        await writeFile(none, "");
        return null;
      }
      const res = await fetcher(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      await writeFile(photo, Buffer.from(await res.arrayBuffer()));
      await unlink(none).catch(() => undefined);
      return photo;
    } catch {
      return null;
    }
  }

  return (jid) => {
    let p = pending.get(jid);
    if (!p) {
      p = load(jid).finally(() => pending.delete(jid));
      pending.set(jid, p);
    }
    return p;
  };
}
