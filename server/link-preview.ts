import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Prévia de link (Open Graph), como o cartão que o WhatsApp mostra abaixo da mensagem. */
export type LinkPreview = { url: string; title: string; description: string | null; image: string | null; site: string };

const MAX_HTML = 512 * 1024;
const TIMEOUT = 6000;
const cache = new Map<string, { at: number; value: Promise<LinkPreview | null> }>();
const TTL = 6 * 60 * 60_000;

/** Endereços da rede local ou do próprio computador não são buscados. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function safeUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Só links http e https.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Endereço local.");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateAddress)) throw new Error("Endereço local.");
  return url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Lê og:/twitter: e <title> do HTML. */
export function parsePreview(html: string, base: URL): LinkPreview | null {
  const head = html.slice(0, MAX_HTML);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    const key = attr("property") ?? attr("name");
    const content = attr("content");
    if (!key || !content) continue;
    const k = (key[1] ?? key[2] ?? key[3]).toLowerCase();
    if (!meta.has(k)) meta.set(k, decode(content[1] ?? content[2] ?? content[3]));
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  const title = meta.get("og:title") || meta.get("twitter:title") || (titleTag ? decode(titleTag) : "");
  if (!title) return null;
  const description = meta.get("og:description") || meta.get("twitter:description") || meta.get("description") || null;
  const rawImage = meta.get("og:image") || meta.get("og:image:url") || meta.get("twitter:image") || null;
  let image: string | null = null;
  if (rawImage) {
    try {
      const u = new URL(rawImage, base);
      if (u.protocol === "https:" || u.protocol === "http:") image = u.href;
    } catch {
      image = null;
    }
  }
  return {
    url: base.href,
    title: title.slice(0, 300),
    description: description ? description.slice(0, 500) : null,
    image,
    site: meta.get("og:site_name") || base.hostname.replace(/^www\./, ""),
  };
}

async function load(raw: string): Promise<LinkPreview | null> {
  let url = await safeUrl(raw);
  const signal = AbortSignal.timeout(TIMEOUT);
  // Redirecionamentos um a um, conferindo cada destino.
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; WhatsAppInbox/1.0; +link-preview)", accept: "text/html,application/xhtml+xml", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel();
      url = await safeUrl(new URL(next, url).href);
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html") || !res.body) {
      await res.body?.cancel();
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_HTML) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      // O <head> já chegou: não precisa do resto.
      if (/<\/head>/i.test(Buffer.from(value).toString("latin1"))) break;
    }
    await reader.cancel().catch(() => {});
    return parsePreview(Buffer.concat(chunks).toString("utf8"), url);
  }
  return null;
}

/** Prévia em cache por 6 h; falha vira null (a mensagem fica só com o link). */
export function linkPreview(raw: string): Promise<LinkPreview | null> {
  const hit = cache.get(raw);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = load(raw).catch(() => null);
  cache.set(raw, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}

// ---- prévia ao enviar: o WhatsApp leva título, descrição e miniatura dentro da própria mensagem

const SEND_WAIT = 3500;
const MAX_THUMB = 100 * 1024;

/** Primeiro link do texto: como foi escrito e a URL completa (sem pontuação final). */
export function firstUrl(text: string): { matched: string; url: string } | null {
  const m = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/i.exec(text);
  if (!m) return null;
  const matched = m[0].replace(/[.,;:!?)\]}]+$/, "");
  return { matched, url: /^https?:\/\//i.test(matched) ? matched : `https://${matched}` };
}

/** Miniatura JPEG pequena da prévia (o app não redimensiona imagem); outra coisa fica sem miniatura. */
async function thumbnail(raw: string): Promise<Buffer | undefined> {
  let url = await safeUrl(raw);
  const signal = AbortSignal.timeout(SEND_WAIT);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: "manual", signal, headers: { accept: "image/jpeg,image/*" } });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel();
      url = await safeUrl(new URL(next, url).href);
      continue;
    }
    const size = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || !/image\/jpe?g/i.test(res.headers.get("content-type") ?? "") || size > MAX_THUMB) {
      await res.body?.cancel();
      return undefined;
    }
    const body = Buffer.from(await res.arrayBuffer());
    return body.length <= MAX_THUMB ? body : undefined;
  }
  return undefined;
}

/** Prévia do primeiro link para ir junto da mensagem enviada; espera no máximo 3,5 s. null = sem prévia. */
export async function sendPreview(text: string): Promise<{ "canonical-url": string; "matched-text": string; title: string; description?: string; jpegThumbnail?: Buffer } | null> {
  const hit = firstUrl(text);
  if (!hit) return null;
  const build = async () => {
    const p = await linkPreview(hit.url);
    if (!p) return null;
    const jpegThumbnail = p.image ? await thumbnail(p.image).catch(() => undefined) : undefined;
    return { "canonical-url": p.url, "matched-text": hit.matched, title: p.title, ...(p.description ? { description: p.description } : {}), ...(jpegThumbnail ? { jpegThumbnail } : {}) };
  };
  return Promise.race([build().catch(() => null), new Promise<null>((r) => setTimeout(r, SEND_WAIT, null).unref())]);
}
