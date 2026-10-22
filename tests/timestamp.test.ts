import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { Store } from "../server/db.ts";
import { WhatsApp } from "../server/whatsapp.ts";

const PN = "5512999990000@s.whatsapp.net";

/** Caminho que o socket real percorre ao entregar uma mensagem. */
type Inner = { ingest(m: unknown, live: boolean, quiet?: boolean): void };

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-timestamp-"));
  const store = new Store(join(dir, "inbox.db"));
  const wa = new WhatsApp(store, join(dir, "auth"));
  return { store, inner: wa as unknown as Inner };
};

const nowSec = () => Math.floor(Date.now() / 1000);
const mine = (id: string, text: string, at = nowSec()) => ({ key: { remoteJid: PN, fromMe: true, id }, message: { conversation: text }, messageTimestamp: at, status: 2 });
const audio = (id: string, at: number) => ({
  key: { remoteJid: PN, fromMe: false, id },
  pushName: "Fernando",
  messageTimestamp: at,
  message: { audioMessage: { url: "https://mmg.whatsapp.net/x", directPath: "/x", mediaKey: Buffer.alloc(32, 1), mimetype: "audio/ogg; codecs=opus", seconds: 5, ptt: true } },
});

test("áudio recebido com relógio do contato 13 min adiantado entra como agora, depois da minha mensagem, e conta como ao vivo", () => {
  const { store, inner } = setup();
  const warn = mock.method(console, "warn", () => undefined);
  inner.ingest(mine("S1", "A retirada tem que ser as 14hrs", nowSec() - 60), true);
  const before = Date.now();
  inner.ingest(audio("F1", nowSec() + 13 * 60), true);
  const after = Date.now();
  const got = store.getMessage(PN, "F1")!;
  assert.equal(got.kind, "audio");
  assert.ok(got.at >= before && got.at <= after, `gravada em ${got.at}, esperado entre ${before} e ${after}`);
  assert.deepEqual(store.listMessages(PN, null).map((m) => m.id), ["S1", "F1"]);
  const chat = store.getChat(PN)!;
  assert.ok(chat.lastAt <= after);
  assert.equal(chat.unread, 1);
  assert.equal(warn.mock.callCount(), 1);
  warn.mock.restore();
});

test("reação e lote de histórico com carimbo no futuro também ficam em agora", () => {
  const { store, inner } = setup();
  const warn = mock.method(console, "warn", () => undefined);
  inner.ingest(mine("S1", "Oi"), true);
  const before = Date.now();
  inner.ingest({ key: { remoteJid: PN, fromMe: false, id: "R1" }, messageTimestamp: nowSec() + 600, message: { reactionMessage: { key: { remoteJid: PN, fromMe: true, id: "S1" }, text: "👍" } } }, true);
  inner.ingest(audio("H1", nowSec() + 3600), false, true);
  const after = Date.now();
  const reacted = store.getMessage(PN, "S1")!;
  assert.ok(reacted.reactions?.length, "reação gravada");
  const hist = store.getMessage(PN, "H1")!;
  assert.ok(hist.at >= before && hist.at <= after);
  warn.mock.restore();
});
