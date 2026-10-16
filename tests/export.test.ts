import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store, type IncomingMessage } from "../server/db.ts";
import { attachmentNames, captionOf, exportFileName, renderExport, stampOf, type ExportRow } from "../server/export.ts";
import { createHandler } from "../server/http.ts";
import { unzipSync, zipSync } from "../server/zip.ts";
import { fakeApi, FAKE_TOKEN } from "./fake-api.ts";

const PN = "5511999990000@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
// 05/10/2026 14:32 em São Paulo (UTC-3).
const AT = Date.UTC(2026, 9, 5, 17, 32);

const row = (over: Partial<ExportRow> = {}): ExportRow => ({ id: "1", at: AT, fromMe: false, author: null, text: "oi", kind: "text", media: null, deleted: false, ...over });

test("export: formato do WhatsApp, autor do grupo, apagada, aviso e mídia oculta", () => {
  assert.equal(stampOf(AT), "05/10/2026 14:32");
  const rows = [
    row({ id: "a", text: "oi" }),
    row({ id: "b", fromMe: true, text: "Carro às 7h\nconfirmado" }),
    row({ id: "c", author: "Ana", text: "cheguei" }),
    row({ id: "d", kind: "system", text: "Ana entrou no grupo" }),
    row({ id: "e", deleted: true, text: "Mensagem apagada" }),
    row({ id: "f", text: "[Imagem] foto do carro", media: { type: "image", mimetype: "image/jpeg", fileName: null } }),
  ];
  const { text, attachments } = renderExport(rows, { chatName: "Turma", withMedia: false });
  assert.equal(
    text,
    [
      "05/10/2026 14:32 - Turma: oi",
      "05/10/2026 14:32 - Você: Carro às 7h\nconfirmado",
      "05/10/2026 14:32 - Ana: cheguei",
      "05/10/2026 14:32 - Ana entrou no grupo",
      "05/10/2026 14:32 - Turma: Mensagem apagada",
      "05/10/2026 14:32 - Turma: <Arquivo de mídia oculto>\nfoto do carro",
      "",
    ].join("\n"),
  );
  assert.deepEqual(attachments, []);
  assert.equal(exportFileName("Ana / Betinhos", false), "Conversa do WhatsApp com Ana _ Betinhos.txt");
});

test("export: nomes dos anexos por dia e tipo; indisponível fica marcado", () => {
  const img = { type: "image", mimetype: "image/jpeg", fileName: null };
  const rows = [
    row({ id: "a", media: img, text: "[Imagem]" }),
    row({ id: "b", media: img, text: "[Imagem] legenda" }),
    row({ id: "c", at: AT + 86_400_000, media: { type: "audio", mimetype: "audio/ogg; codecs=opus", fileName: null }, text: "[Mensagem de voz]" }),
    row({ id: "d", media: { type: "document", mimetype: "application/pdf", fileName: "Recibo.pdf" }, text: "[Documento] Recibo.pdf" }),
  ];
  const names = attachmentNames(rows);
  assert.equal(names.get("a"), "IMG-20261005-WA0001.jpg");
  assert.equal(names.get("b"), "IMG-20261005-WA0002.jpg");
  assert.equal(names.get("c"), "PTT-20261006-WA0001.opus");
  assert.equal(names.get("d"), "DOC-20261005-WA0001-Recibo.pdf");
  assert.equal(captionOf(rows[3]!), "");
  const { text, attachments } = renderExport(rows, { chatName: "Ana", withMedia: true, available: (id) => id !== "b" });
  assert.match(text, /Ana: IMG-20261005-WA0001\.jpg \(arquivo anexado\)\n/);
  assert.match(text, /Ana: <Arquivo de mídia indisponível>\nlegenda\n/);
  assert.deepEqual(attachments.map((a) => a.id), ["a", "c", "d"]);
});

test("zip: entradas com nome UTF-8 voltam iguais (deflate e armazenado)", () => {
  const texto = Buffer.from("Conversa com acentuação ".repeat(50), "utf8");
  const binario = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256));
  const zip = zipSync([{ name: "Conversa do WhatsApp com Ação.txt", data: texto }, { name: "IMG-20261005-WA0001.jpg", data: binario }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const back = unzipSync(zip);
  assert.deepEqual(back.map((e) => e.name), ["Conversa do WhatsApp com Ação.txt", "IMG-20261005-WA0001.jpg"]);
  assert.ok(back[0]!.data.equals(texto));
  assert.ok(back[1]!.data.equals(binario));
});

test("Store.exportRows: ordem cronológica e autor do grupo separado", () => {
  const store = new Store(":memory:");
  const base = (over: Partial<IncomingMessage>): IncomingMessage => ({ chatJid: GROUP, id: "x", rawJid: GROUP, fromMe: false, at: AT, text: "", kind: "text", ...over });
  store.addMessage(base({ id: "2", at: AT + 1000, participant: PN, text: "Ana: depois" }), true);
  store.addMessage(base({ id: "1", at: AT, participant: PN, text: "Ana: antes" }), true);
  store.addMessage(base({ id: "3", at: AT + 2000, fromMe: true, text: "ok" }), true);
  const rows = store.exportRows(GROUP);
  assert.deepEqual(rows.map((r) => [r.id, r.author, r.text]), [["1", "Ana", "antes"], ["2", "Ana", "depois"], ["3", null, "ok"]]);
});

test("HTTP: /export baixa o arquivo e apaga o temporário; /photo valida grupo e JPEG", async () => {
  const store = new Store(":memory:");
  store.addMessage({ chatJid: PN, id: "1", rawJid: PN, fromMe: false, at: AT, text: "oi", kind: "text" }, true);
  store.addMessage({ chatJid: GROUP, id: "g1", rawJid: GROUP, fromMe: false, at: AT, text: "Ana: oi", kind: "text", participant: PN }, true);
  const dir = mkdtempSync(join(tmpdir(), "inbox-export-"));
  const photos: (Buffer | null)[] = [];
  const api = fakeApi(store, {
    exportChat: async (jid, withMedia) => {
      const file = join(dir, `e-${Date.now()}.txt`);
      writeFileSync(file, `${jid} ${withMedia}`);
      return { file, fileName: "Conversa do WhatsApp com Ana.txt", mimetype: "text/plain; charset=utf-8" };
    },
    setGroupPhoto: async (_jid, jpeg) => void photos.push(jpeg),
  });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${api.port}`;
  const headers = { "x-inbox-token": FAKE_TOKEN, "content-type": "application/json" };
  try {
    const res = await fetch(`${base}/api/chats/${encodeURIComponent(PN)}/export?media=1`, { headers });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="Conversa do WhatsApp com Ana.txt"/);
    assert.equal(await res.text(), `${PN} true`);
    assert.equal((await fetch(`${base}/api/chats/${encodeURIComponent(PN)}/photo`, { method: "POST", headers, body: JSON.stringify({ data: "AAAA" }) })).status, 400);
    assert.equal((await fetch(`${base}/api/chats/${encodeURIComponent(GROUP)}/photo`, { method: "POST", headers, body: JSON.stringify({ data: Buffer.from("not a jpeg").toString("base64") }) })).status, 400);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal((await fetch(`${base}/api/chats/${encodeURIComponent(GROUP)}/photo`, { method: "POST", headers, body: JSON.stringify({ data: jpeg.toString("base64") }) })).status, 200);
    assert.equal((await fetch(`${base}/api/chats/${encodeURIComponent(GROUP)}/photo`, { method: "DELETE", headers, body: "{}" })).status, 200);
    assert.deepEqual(photos.map((p) => (p ? p.length : null)), [6, null]);
  } finally {
    server.close();
  }
});
