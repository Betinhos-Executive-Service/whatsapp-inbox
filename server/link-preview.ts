import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { WAUrlInfo } from "@whiskeysockets/baileys";

/**
 * Prévia de link ao enviar (título, descrição e miniatura da página), como o WhatsApp faz.
 * A página é lida daqui do computador; endereços internos (rede local, localhost) ficam de fora.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/i;
const MAX_HTML = 512 * 1024;
const MAX_THUMB = 100 * 1024;
const TIMEOUT_MS = 3000;

/** Primeiro link do texto: como foi escrito e a URL completa. */
export function firstUrl(text: string): { matched: string; url: string } | null {
  const m = URL_RE.exec(text);
  if (!m) return null;
  // Pontuação final ("veja https://x.com.") não faz parte do link.
  const matched = m[0].replace(/[.,;:!?)\]}]+$/, "");
  return { matched, url: /^https?:\/\//i.test(matched) ? matched : `https://${matched}` };
}

/** IP de rede interna, loopback ou link-local. */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

async function isPublicHost(host: string): Promise<boolean> {
  const name = host.replace(/^\[|\]$/g, "");
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return false;
  if (isIP(name)) return !isPrivateIp(name);
  try {
    const addresses = await lookup(name, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** GET seguindo até 3 redirecionamentos, conferindo cada destino. */
async function safeFetch(url: URL, accept: string): Promise<Response | null> {
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(target.protocol) || !(await isPublicHost(target.hostname))) return null;
    const res = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept, "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WhatsAppInbox/1.0" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      target = new URL(location, target);
      continue;
    }
    return res.ok ? res : null;
  }
  return null;
}

/** Lê até `limit` bytes; passou disso, devolve o começo (`partial`) ou null. */
async function readLimited(res: Response, limit: number, partial = false): Promise<Buffer | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return partial && chunks.length ? Buffer.concat(chunks) : null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Metadados Open Graph (ou <title>) do HTML da página. */
export function parseMeta(html: string): { title: string | null; description: string | null; image: string | null; url: string | null } {
  const head = html.slice(0, 200_000);
  const meta = (names: string[]): string | null => {
    for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (!key || !names.includes(key)) continue;
      const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
      const value = decodeEntities(content?.[1] ?? content?.[2] ?? "");
      if (value) return value;
    }
    return null;
  };
  const title = meta(["og:title", "twitter:title"]) ?? (decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "") || null);
  return {
    title: title ? title.slice(0, 200) : null,
    description: meta(["og:description", "twitter:description", "description"])?.slice(0, 300) ?? null,
    image: meta(["og:image", "og:image:url", "twitter:image"]),
    url: meta(["og:url"]),
  };
}

export async function linkPreview(text: string): Promise<WAUrlInfo | null> {
  const hit = firstUrl(text);
  if (!hit) return null;
  let url: URL;
  try {
    url = new URL(hit.url);
  } catch {
    return null;
  }
  const res = await safeFetch(url, "text/html,application/xhtml+xml");
  if (!res || !/html/i.test(res.headers.get("content-type") ?? "")) return null;
  const html = await readLimited(res, MAX_HTML, true);
  if (!html) return null;
  const meta = parseMeta(html.toString("utf8"));
  if (!meta.title) return null;
  let jpegThumbnail: Buffer | undefined;
  if (meta.image) {
    try {
      const img = await safeFetch(new URL(meta.image, res.url || url), "image/jpeg,image/*");
      // A miniatura vai no próprio texto da mensagem: só JPEG pequeno (o app não redimensiona imagem).
      if (img && /image\/jpe?g/i.test(img.headers.get("content-type") ?? "")) jpegThumbnail = (await readLimited(img, MAX_THUMB)) ?? undefined;
    } catch {
      jpegThumbnail = undefined;
    }
  }
  return {
    "canonical-url": meta.url ?? hit.url,
    "matched-text": hit.matched,
    title: meta.title,
    description: meta.description ?? undefined,
    jpegThumbnail,
  };
}
