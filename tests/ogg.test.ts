import assert from "node:assert/strict";
import { test } from "node:test";
import { opusSamples, webmToOgg } from "../ui/ogg.ts";

const el = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body];
const head = [...Buffer.from("OpusHead"), 1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0];
// TOC 0xF8 = config 31 (CELT 20 ms), 1 quadro → 960 amostras.
const block = (n: number) => el([0xa3], [0x81, 0, n, 0x80, 0xf8, ...Array(n).fill(n)]);

test("WebM/Opus do gravador vira Ogg/Opus válido com duração", () => {
  const webm = Uint8Array.from([
    ...el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01]),
    0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // Segment, tamanho desconhecido
    ...el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0x63, 0xa2], head))),
    0x1f, 0x43, 0xb6, 0x75, 0xff, // Cluster, tamanho desconhecido
    ...el([0xe7], [0]),
    ...Array.from({ length: 60 }, (_, i) => block(1 + (i % 5))).flat(),
  ]);
  const { ogg, seconds } = webmToOgg(webm);
  assert.equal(seconds, (60 * 960 - 312) / 48000);
  // percorre as páginas conferindo assinatura e flags
  let pos = 0;
  const flags: number[] = [];
  let packets = 0;
  while (pos < ogg.length) {
    assert.equal(Buffer.from(ogg.slice(pos, pos + 4)).toString(), "OggS");
    flags.push(ogg[pos + 5]);
    const n = ogg[pos + 26];
    const lacing = ogg.slice(pos + 27, pos + 27 + n);
    packets += lacing.filter((l) => l < 255).length;
    pos += 27 + n + lacing.reduce((s, l) => s + l, 0);
  }
  assert.equal(pos, ogg.length);
  assert.equal(flags[0], 0x02);
  assert.equal(flags.at(-1), 0x04);
  assert.equal(packets, 62); // OpusHead + OpusTags + 60 áudio
  assert.equal(opusSamples(Uint8Array.of(0x03, 0x03)), 3 * 480); // SILK 10 ms, 3 quadros
});
