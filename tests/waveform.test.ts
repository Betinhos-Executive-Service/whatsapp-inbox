import assert from "node:assert/strict";
import { test } from "node:test";
import { waveformFrom, WAVEFORM_BARS } from "../ui/waveform.ts";
import { stickerFit } from "../ui/sticker.ts";
import { photoFileName } from "../ui/camera-utils.ts";
import { albumParentId, extractMedia } from "../server/text.ts";

test("forma de onda: 64 inteiros 0..100, pico em 100, silêncio sem NaN, entrada curta", () => {
  const samples = new Float32Array(48000);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 50) * (i / samples.length);
  const w = waveformFrom(samples);
  assert.equal(w.length, WAVEFORM_BARS);
  assert.ok(w.every((v) => Number.isInteger(v) && v >= 0 && v <= 100));
  assert.equal(Math.max(...w), 100);
  assert.ok(w[0]! < w[63]!, "cresce com a amplitude");
  assert.deepEqual(waveformFrom(new Float32Array(1000)), new Array(64).fill(0));
  assert.deepEqual(waveformFrom([]), new Array(64).fill(0));
  assert.equal(waveformFrom([0.5, 1, 0.25]).length, 64);
});

test("figurinha: a imagem entra inteira e centralizada no quadrado de 512", () => {
  assert.deepEqual(stickerFit(1024, 512), { x: 0, y: 128, width: 512, height: 256 });
  assert.deepEqual(stickerFit(300, 600), { x: 128, y: 0, width: 256, height: 512 });
  assert.deepEqual(stickerFit(512, 512), { x: 0, y: 0, width: 512, height: 512 });
  assert.deepEqual(stickerFit(100, 100), { x: 0, y: 0, width: 512, height: 512 });
});

test("câmera: nome do arquivo da foto com data e hora", () => {
  assert.equal(photoFileName(new Date(2026, 9, 5, 14, 7)), "foto-2026-10-05-1407.jpg");
});

test("mídia recebida: waveform só em voz; álbum pelo messageAssociation", () => {
  const voice = extractMedia({ audioMessage: { mediaKey: new Uint8Array([1]), directPath: "/v", ptt: true, waveform: new Uint8Array([0, 50, 100]) } });
  assert.deepEqual(voice?.waveform, [0, 50, 100]);
  const file = extractMedia({ audioMessage: { mediaKey: new Uint8Array([1]), directPath: "/v", ptt: false, waveform: new Uint8Array([1]) } });
  assert.equal(file?.waveform, null);
  assert.equal(albumParentId({ imageMessage: {}, messageContextInfo: { messageAssociation: { associationType: 1, parentMessageKey: { id: "ALB1" } } } }), "ALB1");
  assert.equal(albumParentId({ imageMessage: {} }, { messageContextInfo: { messageAssociation: { associationType: "MEDIA_ALBUM", parentMessageKey: { id: "ALB2" } } } }), "ALB2");
  assert.equal(albumParentId({ imageMessage: {}, messageContextInfo: { messageAssociation: { associationType: 2, parentMessageKey: { id: "X" } } } }), null);
});

test("álbum: agrupa pelo id do WhatsApp (≥ 2) ou por heurística (≥ 4 em < 1 min); legenda, citação e remetente quebram", async () => {
  const { groupAlbums } = await import("../ui/album.ts");
  type M = import("../ui/api.ts").Message;
  const base = (id: string, at: number, over: Partial<M> = {}): M => ({
    chatJid: "x", id, fromMe: false, at, text: "[Imagem]", kind: "image", contacts: null, quoted: null, deleted: false, sender: null, ack: null, editedAt: null, reactions: [], extra: null, poll: null, starred: false, forwarded: 0,
    media: { type: "image", mimetype: "image/jpeg", fileName: null, size: null, seconds: null, ptt: false, waveform: null, album: null },
    ...over,
  });
  const withAlbum = (id: string, at: number, album: string) => base(id, at, { media: { ...base(id, at).media!, album } });
  const t = Date.UTC(2026, 9, 5, 15, 0);
  const byId = groupAlbums([withAlbum("a", t, "ALB"), withAlbum("b", t + 1000, "ALB"), base("c", t + 2000, { text: "oi", kind: "text", media: null })]);
  assert.deepEqual([...byId.albums.keys()], ["a"]);
  assert.deepEqual([...byId.hidden], ["b"]);
  // Heurística: 3 fotos soltas não viram álbum; 4 viram.
  const three = groupAlbums([base("a", t), base("b", t + 1000), base("c", t + 2000)]);
  assert.equal(three.albums.size, 0);
  const four = groupAlbums([base("a", t), base("b", t + 1000), base("c", t + 2000), base("d", t + 3000), base("e", t + 120_000)]);
  assert.deepEqual(four.albums.get("a")?.map((m) => m.id), ["a", "b", "c", "d"]);
  assert.ok(!four.hidden.has("e"), "mais de 1 min depois fica fora");
  // Legenda, citação e outro remetente quebram a sequência.
  const broken = groupAlbums([base("a", t), base("b", t + 1000, { text: "[Imagem] legenda" }), base("c", t + 2000), base("d", t + 3000), base("e", t + 4000, { fromMe: true })]);
  assert.equal(broken.albums.size, 0);
  // Em grupo, o texto vem com o autor na frente e ainda conta como "sem legenda".
  const group = groupAlbums(["a", "b", "c", "d"].map((id, i) => base(id, t + i * 1000, { text: "Ana: [Imagem]", sender: "ana@s.whatsapp.net" })));
  assert.equal(group.albums.get("a")?.length, 4);
});
