/**
 * O Chromium só grava Opus em WebM; o WhatsApp só toca mensagem de voz em Ogg/Opus.
 * Aqui os pacotes Opus saem do WebM e entram em páginas Ogg, sem recodificar.
 */

const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK = 0xa1;
const ID_CODEC_PRIVATE = 0x63a2;
/** Elementos-contêiner: entramos neles em vez de pular (Segment e Cluster vêm com tamanho desconhecido). */
const MASTER = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0]);

function readVint(b: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } {
  const first = b[pos];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error("WebM inválido.");
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** Pacotes Opus e o cabeçalho OpusHead (CodecPrivate) de um WebM de uma faixa só. */
export function webmOpusPackets(b: Uint8Array): { head: Uint8Array | null; packets: Uint8Array[] } {
  const packets: Uint8Array[] = [];
  let head: Uint8Array | null = null;
  let pos = 0;
  while (pos < b.length) {
    if (b.length - pos < 2) break;
    const id = readVint(b, pos, true);
    const size = readVint(b, pos + id.length, false);
    const start = pos + id.length + size.length;
    if (MASTER.has(id.value) || size.unknown) {
      pos = start;
      continue;
    }
    const end = Math.min(b.length, start + size.value);
    if (id.value === ID_CODEC_PRIVATE) head = b.slice(start, end);
    if (id.value === ID_SIMPLE_BLOCK || id.value === ID_BLOCK) {
      const track = readVint(b, start, false);
      const flags = b[start + track.length + 2];
      if (flags & 0x06) throw new Error("WebM com lacing não é suportado.");
      packets.push(b.slice(start + track.length + 3, end));
    }
    pos = end;
  }
  return { head, packets };
}

/** Amostras a 48 kHz de um pacote Opus, pelo byte TOC (RFC 6716, 3.1). */
export function opusSamples(p: Uint8Array): number {
  if (!p.length) return 0;
  const config = p[0] >> 3;
  const ms = config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
  const c = p[0] & 3;
  const frames = c === 0 ? 1 : c < 3 ? 2 : (p[1] ?? 0) & 0x3f;
  return frames * ms * 48;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function crc(page: Uint8Array): number {
  let c = 0;
  for (const byte of page) c = ((c << 8) ^ CRC[((c >>> 24) ^ byte) & 0xff]) >>> 0;
  return c;
}

function page(packets: Uint8Array[], granule: number, seq: number, serial: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  const bodyLength = packets.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + bodyLength);
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  out[5] = flags;
  v.setUint32(6, granule % 2 ** 32, true);
  v.setUint32(10, Math.floor(granule / 2 ** 32), true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) {
    out.set(p, at);
    at += p.length;
  }
  v.setUint32(22, crc(out), true);
  return out;
}

function defaultHead(): Uint8Array {
  const h = new Uint8Array(19);
  h.set(new TextEncoder().encode("OpusHead"), 0);
  const v = new DataView(h.buffer);
  h[8] = 1; // versão
  h[9] = 1; // canais
  v.setUint16(10, 312, true); // pre-skip
  v.setUint32(12, 48000, true);
  return h;
}

function tags(): Uint8Array {
  const vendor = new TextEncoder().encode("WhatsApp Inbox");
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  t.set(new TextEncoder().encode("OpusTags"), 0);
  new DataView(t.buffer).setUint32(8, vendor.length, true);
  t.set(vendor, 12);
  return t;
}

/** WebM/Opus → Ogg/Opus. Devolve também a duração em segundos. */
export function webmToOgg(webm: Uint8Array): { ogg: Uint8Array; seconds: number } {
  const { head, packets } = webmOpusPackets(webm);
  if (!packets.length) throw new Error("Gravação vazia.");
  const opusHead = head && new TextDecoder().decode(head.slice(0, 8)) === "OpusHead" ? head : defaultHead();
  const serial = (Math.random() * 2 ** 32) >>> 0;
  const pages: Uint8Array[] = [page([opusHead], 0, 0, serial, 0x02), page([tags()], 0, 1, serial, 0)];
  let granule = 0;
  let batch: Uint8Array[] = [];
  let segments = 0;
  const flush = (last: boolean) => {
    pages.push(page(batch, granule, pages.length, serial, last ? 0x04 : 0));
    batch = [];
    segments = 0;
  };
  packets.forEach((p, i) => {
    const need = Math.floor(p.length / 255) + 1;
    if (segments + need > 255 || batch.length >= 50) flush(false);
    batch.push(p);
    segments += need;
    granule += opusSamples(p);
    if (i === packets.length - 1) flush(true);
  });
  const preSkip = new DataView(opusHead.buffer, opusHead.byteOffset).getUint16(10, true);
  const ogg = new Uint8Array(pages.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of pages) {
    ogg.set(p, at);
    at += p.length;
  }
  return { ogg, seconds: Math.max(0, granule - preSkip) / 48000 };
}
