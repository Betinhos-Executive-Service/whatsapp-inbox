import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DELETED_TEXT, Store, type IncomingMessage } from "../server/db.ts";
import { PhotoCache } from "../server/photos.ts";
import { extractContext, revokedId } from "../server/text.ts";

const PN = "5511999990000@s.whatsapp.net";
const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  chatJid: PN,
  id: `m${Math.random()}`,
  rawJid: PN,
  fromMe: false,
  at: Date.now(),
  text: "Olá",
  kind: "text",
  ...over,
});

test("citação e menções saem do contextInfo; revogação devolve o id apagado", () => {
  const ctx = extractContext({
    extendedTextMessage: {
      text: "@5511888880000 confirma?",
      contextInfo: { stanzaId: "ABC", participant: PN, mentionedJid: ["5511888880000@s.whatsapp.net"], quotedMessage: { conversation: "Carro às 7h" } },
    },
  });
  assert.deepEqual(ctx.quoted, { id: "ABC", participant: PN, text: "Carro às 7h" });
  assert.deepEqual(ctx.mentions, ["5511888880000@s.whatsapp.net"]);
  assert.deepEqual(extractContext({ conversation: "oi" }), { quoted: null, mentions: [] });
  assert.equal(revokedId({ protocolMessage: { type: 0, key: { id: "XYZ" } } }), "XYZ");
  assert.equal(revokedId({ protocolMessage: { type: 14, key: { id: "XYZ" } } }), null);
});

test("mensagem guarda a citação; apagar para todos troca o texto; apagar para mim remove e recalcula a prévia", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a", text: "primeira", at: 1000 }), false);
  s.addMessage(msg({ id: "b", text: "segunda", at: 2000, fromMe: true, quoted: JSON.stringify({ id: "a", text: "primeira", fromMe: false, author: null }) }), false);
  const b = s.getMessage(PN, "b")!;
  assert.deepEqual(b.quoted, { id: "a", text: "primeira", fromMe: false, author: null });
  assert.equal(s.messageKey(PN, "b")?.rawJid, PN);

  const revoked = s.markRevoked(PN, "b")!;
  assert.equal(revoked.deleted, true);
  assert.equal(revoked.text, DELETED_TEXT);
  assert.equal(revoked.quoted, null);
  assert.equal(s.getChat(PN)?.lastText, DELETED_TEXT);
  assert.equal(s.markRevoked(PN, "b"), null, "segunda revogação não muda nada");

  assert.equal(s.deleteMessage(PN, "b"), true);
  assert.equal(s.getChat(PN)?.lastText, "primeira");
  assert.equal(s.getChat(PN)?.lastAt, 1000);
  assert.equal(s.listMessages(PN, null).length, 1);
});

test("foto: baixa uma vez, guarda em disco e lembra quem não tem foto", async () => {
  const s = new Store(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "photos-"));
  let asks = 0;
  let downloads = 0;
  const cache = new PhotoCache(
    dir,
    s,
    { url: async (jid) => (asks++, jid.startsWith("55") ? "https://pps.whatsapp.net/x.jpg" : null) },
    (async () => (downloads++, new Response(new Uint8Array([1, 2, 3])))) as unknown as typeof fetch,
  );
  assert.deepEqual([...(await cache.thumb(PN))!], [1, 2, 3]);
  assert.deepEqual([...(await cache.thumb(PN))!], [1, 2, 3]);
  assert.equal(downloads, 1, "segunda leitura vem do disco");
  assert.equal(await cache.thumb("123@lid"), null);
  assert.equal(await cache.thumb("123@lid"), null);
  assert.equal(asks, 2, "sem foto também fica em cache");
  s.forgetPhoto(PN);
  await cache.thumb(PN);
  assert.equal(downloads, 2, "foto trocada busca de novo");
});
