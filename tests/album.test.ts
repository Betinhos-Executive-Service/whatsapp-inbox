import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { createHandler } from "../server/http.ts";
import { albumCounts, albumKind } from "../server/media.ts";
import { fakeApi } from "./fake-api.ts";

const PN = "5511999990000@s.whatsapp.net";

test("álbum: cabeçalho conta fotos e vídeos; figurinha, GIF, áudio e documento não entram", () => {
  assert.equal(albumKind("image/jpeg"), "image");
  assert.equal(albumKind("image/png; charset=binary"), "image");
  assert.equal(albumKind("video/mp4"), "video");
  assert.equal(albumKind("image/gif"), null);
  assert.equal(albumKind("image/webp"), "image");
  assert.equal(albumKind("audio/ogg"), null);
  assert.equal(albumKind("application/pdf"), null);
  assert.deepEqual(albumCounts(["image/jpeg", "image/png", "video/mp4"]), { expectedImageCount: 2, expectedVideoCount: 1 });
  assert.throws(() => albumCounts(["image/jpeg"]), /pelo menos 2/);
  assert.throws(() => albumCounts(["image/jpeg", "application/pdf"]), /fotos e vídeos/);
});

test("rota /album: valida a lista, decodifica cada arquivo e repassa a citação", async () => {
  const store = new Store(":memory:");
  store.addMessage({ chatJid: PN, id: "m1", rawJid: PN, fromMe: false, at: 1, text: "oi", kind: "text" }, true);
  const calls: { jid: string; files: { body: Buffer; mimetype: string; fileName: string; caption?: string }[]; quotedId?: string }[] = [];
  const api = fakeApi(store, { sendAlbum: async (jid, files, quotedId) => void calls.push({ jid, files, quotedId }) });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${api.port}`;
  const post = (body: unknown) =>
    fetch(`${base}/api/chats/${encodeURIComponent(PN)}/album`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const foto = (name: string, bytes: string, caption?: string) => ({ fileName: name, mimetype: "image/jpeg", data: Buffer.from(bytes).toString("base64"), caption });
  try {
    assert.equal((await post({ files: [foto("a.jpg", "a")] })).status, 400, "um item só não é álbum");
    assert.equal((await post({ files: [foto("a.jpg", "a"), { ...foto("b.pdf", "b"), mimetype: "application/pdf" }] })).status, 400, "documento não entra");
    assert.equal((await post({ files: [foto("a.jpg", "a"), foto("b.jpg", "")] })).status, 400, "arquivo vazio");
    const ok = await post({ files: [foto("a.jpg", "aaa", "legenda"), foto("b.jpg", "bbb"), { fileName: "c.mp4", mimetype: "video/mp4", data: Buffer.from("ccc").toString("base64") }], quotedId: "m1" });
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].jid, PN);
    assert.equal(calls[0].quotedId, "m1");
    assert.deepEqual(
      calls[0].files.map((f) => [f.fileName, f.mimetype, f.body.toString(), f.caption]),
      [["a.jpg", "image/jpeg", "aaa", "legenda"], ["b.jpg", "image/jpeg", "bbb", undefined], ["c.mp4", "video/mp4", "ccc", undefined]],
    );
  } finally {
    server.close();
  }
});
