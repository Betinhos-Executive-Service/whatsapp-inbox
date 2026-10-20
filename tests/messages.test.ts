import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DELETED_TEXT, Store, type IncomingMessage } from "../server/db.ts";
import { chronological, isLiveArrival } from "../server/history.ts";
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
  assert.deepEqual(extractContext({ conversation: "oi" }), { quoted: null, mentions: [], forwarded: 0 });
  // Selo "Encaminhada": isForwarded ou score; a partir de 5 vira "muitas vezes".
  assert.equal(extractContext({ extendedTextMessage: { text: "x", contextInfo: { isForwarded: true } } }).forwarded, 1);
  assert.equal(extractContext({ imageMessage: { caption: "x", contextInfo: { forwardingScore: 3, isForwarded: true } } }).forwarded, 1);
  assert.equal(extractContext({ extendedTextMessage: { text: "x", contextInfo: { forwardingScore: 7, isForwarded: true } } }).forwarded, 2);
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

test("mensagens no mesmo segundo saem na ordem de chegada, inclusive ao paginar", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "z1", text: "antes", at: 1000 }), false);
  for (const id of ["p1", "p2", "p3"]) s.addMessage(msg({ id, text: id, at: 5000 }), false);
  s.addMessage(msg({ id: "z2", text: "depois", at: 9000 }), false);
  assert.deepEqual(s.listMessages(PN, null).map((m) => m.id), ["z1", "p1", "p2", "p3", "z2"]);
  assert.deepEqual(s.listMessages(PN, null, 2).map((m) => m.id), ["p3", "z2"]);
  // A página anterior inclui o segundo da mais antiga na tela, para não pular as que empatam.
  assert.deepEqual(s.listMessages(PN, 5000).map((m) => m.id), ["z1", "p1", "p2", "p3"]);
  assert.equal(s.lastMessageKey(PN)?.id, "z2");
});

test("histórico do WhatsApp (mais nova primeiro) é gravado em ordem cronológica, inclusive no mesmo segundo", () => {
  const batch = [
    { key: { id: "b2" }, messageTimestamp: 9 },
    { key: { id: "p3" }, messageTimestamp: 5 },
    { key: { id: "p2" }, messageTimestamp: 5 },
    { key: { id: "p1" }, messageTimestamp: 5 },
    { key: { id: "a1" }, messageTimestamp: 1 },
  ];
  assert.deepEqual(chronological(batch).map((m) => m.key.id), ["a1", "p1", "p2", "p3", "b2"]);
  // Gravadas nessa ordem, o rowid desempata como o WhatsApp mostra.
  const s = new Store(":memory:");
  for (const m of chronological(batch)) s.insertMessage(msg({ id: m.key.id, text: m.key.id, at: m.messageTimestamp * 1000 }), false);
  assert.deepEqual(s.listMessages(PN, null).map((m) => m.id), ["a1", "p1", "p2", "p3", "b2"]);
});

test("selo 'Encaminhada' fica gravado na mensagem e some quando apagada", () => {
  const store = new Store(":memory:");
  store.addMessage(msg({ id: "f1", forwarded: 1 }), true);
  store.addMessage(msg({ id: "f2", at: 2, forwarded: 2 }), true);
  store.addMessage(msg({ id: "f3", at: 3 }), true);
  assert.equal(store.getMessage(PN, "f1")?.forwarded, 1);
  assert.equal(store.getMessage(PN, "f2")?.forwarded, 2);
  assert.equal(store.getMessage(PN, "f3")?.forwarded, 0);
  store.markRevoked(PN, "f2");
  assert.equal(store.getMessage(PN, "f2")?.forwarded, 0);
});

test("presença: prioridade dos estados, visto por último em ms e grupo só com digitando/gravando", async () => {
  const { presenceOf } = await import("../server/presence.ts");
  assert.deepEqual(presenceOf({ a: { lastKnownPresence: "unavailable", lastSeen: 1_700_000_000 } }, false), { state: "unavailable", lastSeen: 1_700_000_000_000 });
  assert.deepEqual(presenceOf({ a: { lastKnownPresence: "unavailable" } }, false), { state: "unavailable", lastSeen: null });
  assert.deepEqual(presenceOf({ a: { lastKnownPresence: "available" } }, false), { state: "available", lastSeen: null });
  assert.deepEqual(presenceOf({ a: { lastKnownPresence: "composing" }, b: { lastKnownPresence: "recording" } }, true), { state: "recording", lastSeen: null });
  assert.deepEqual(presenceOf({ a: { lastKnownPresence: "available" } }, true), { state: null, lastSeen: null });
  const { lastSeenLabel } = await import("../ui/format.ts");
  const now = Date.UTC(2026, 9, 5, 17, 32);
  assert.equal(lastSeenLabel(now - 60_000, now), "visto por último hoje às 14:31");
  assert.equal(lastSeenLabel(now - 86_400_000, now), "visto por último ontem às 14:32");
  assert.equal(lastSeenLabel(now - 3 * 86_400_000, now), "visto por último em 02/10/2026 às 14:32");
});

test("recibos de grupo: cada marco só avança, tique vai a entregue e a lista sai com nome", () => {
  const store = new Store(":memory:");
  const group = "120363000000000000@g.us";
  const ana = "5511888880000@s.whatsapp.net";
  store.addMessage(msg({ chatJid: group, rawJid: group, id: "r1", fromMe: true, ack: 2 }), true);
  store.addMessage(msg({ chatJid: group, rawJid: group, id: "r2", fromMe: false, participant: ana, text: "Ana: oi" }), true);
  store.setNames(ana, { push: "Ana" });
  assert.equal(store.recordReceipt(group, "r2", ana, { deliveredAt: 1000 }), null, "recibo de mensagem alheia não conta");
  const first = store.recordReceipt(group, "r1", ana, { deliveredAt: 1000 });
  assert.equal(first?.message.ack, 3);
  assert.equal(first?.readCount, 0);
  const second = store.recordReceipt(group, "r1", ana, { readAt: 2000 });
  assert.equal(second?.readCount, 1);
  assert.deepEqual(store.messageReceipts(group, "r1"), [{ participant: ana, name: "Ana", deliveredAt: 1000, readAt: 2000, playedAt: null }]);
  // Recibo repetido não volta atrás.
  store.recordReceipt(group, "r1", ana, { deliveredAt: 5000 });
  assert.equal(store.messageReceipts(group, "r1")[0]?.deliveredAt, 1000);
  store.deleteMessage(group, "r1");
  assert.deepEqual(store.messageReceipts(group, "r1"), []);
});

test("mensagem atrasada mais nova que a conversa conta como ao vivo", () => {
  const now = 1_800_000_000_000;
  const win = 2 * 60_000;
  const ontem = now - 20 * 3600_000;
  // Chegou agora: ao vivo, como antes.
  assert.equal(isLiveArrival(true, now - 10_000, now - 3600_000, win, now), true);
  // Enviada ontem, chegou hoje, e a conversa não tem nada mais novo: nova para quem usa.
  assert.equal(isLiveArrival(true, ontem, ontem - 3600_000, win, now), true);
  assert.equal(isLiveArrival(true, ontem, null, win, now), true);
  // Antiga e a conversa já tem mensagem mais nova: só completa o histórico.
  assert.equal(isLiveArrival(true, ontem, now - 3600_000, win, now), false);
  // Lote de histórico nunca é ao vivo.
  assert.equal(isLiveArrival(false, now - 10_000, 0, win, now), false);
  // Gravada como ao vivo, a mensagem antiga vira não lida e abre a conversa.
  const s = new Store(":memory:");
  s.insertMessage(msg({ id: "velha", at: ontem - 3600_000 }), false);
  s.markRead(PN);
  s.insertMessage(msg({ id: "atrasada", at: ontem }), isLiveArrival(true, ontem, s.getChat(PN)!.lastAt, win, now));
  assert.equal(s.getChat(PN)!.unread, 1);
  assert.equal(s.getChat(PN)!.status, "aberta");
});
