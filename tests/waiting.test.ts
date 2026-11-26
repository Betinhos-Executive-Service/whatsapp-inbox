import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { proto } from "@whiskeysockets/baileys";
import { Store, WAITING_TEXT } from "../server/db.ts";
import { WhatsApp } from "../server/whatsapp.ts";

const PN = "5512999990000@s.whatsapp.net";

/** Caminho que o socket real percorre ao entregar uma mensagem. */
type Inner = { ingest(m: unknown, live: boolean, quiet?: boolean): void };

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-waiting-"));
  const store = new Store(join(dir, "inbox.db"));
  const wa = new WhatsApp(store, join(dir, "auth"));
  const events: { name: string; id: string }[] = [];
  wa.on("message", ({ message }) => events.push({ name: "message", id: message.id }));
  wa.on("update", ({ message }) => events.push({ name: "update", id: message.id }));
  wa.on("diag", () => undefined);
  return { store, inner: wa as unknown as Inner, events };
};

const nowSec = () => Math.floor(Date.now() / 1000);
const undecrypted = (id: string) => ({
  key: { remoteJid: PN, fromMe: false, id },
  messageTimestamp: nowSec() - 30,
  messageStubType: proto.WebMessageInfo.StubType.CIPHERTEXT,
  messageStubParameters: ["No matching sessions found for message"],
});
const text = (id: string, body: string) => ({ key: { remoteJid: PN, fromMe: false, id }, message: { conversation: body }, messageTimestamp: nowSec() - 30, pushName: "Ana" });

test("mensagem que não decifrou vira aviso não lido e o reenvio troca o aviso pelo conteúdo", () => {
  const { store, inner, events } = setup();
  inner.ingest(undecrypted("C1"), true);
  const waiting = store.getMessage(PN, "C1");
  assert.equal(waiting?.kind, "system");
  assert.equal(waiting?.text, WAITING_TEXT);
  assert.equal(store.getChat(PN)?.unread, 1);
  assert.equal(store.getChat(PN)?.lastText, WAITING_TEXT);

  // Retentativa que também falha não duplica o aviso.
  inner.ingest(undecrypted("C1"), true);
  assert.equal(store.getChat(PN)?.unread, 1);

  inner.ingest(text("C1", "pra jogar"), true);
  const filled = store.getMessage(PN, "C1");
  assert.equal(filled?.kind, "text");
  assert.equal(filled?.text, "pra jogar");
  // Não conta de novo como não lida e a lista mostra o texto real.
  assert.equal(store.getChat(PN)?.unread, 1);
  assert.equal(store.getChat(PN)?.lastText, "pra jogar");
  assert.deepEqual(events, [{ name: "message", id: "C1" }, { name: "update", id: "C1" }, { name: "message", id: "C1" }]);
});

test("mensagem comum repetida continua como chegou (só o aviso é trocado)", () => {
  const { store, inner } = setup();
  inner.ingest(text("T1", "oi"), true);
  inner.ingest(text("T1", "outro"), true);
  assert.equal(store.getMessage(PN, "T1")?.text, "oi");
});

test("reenvio que não vira mensagem própria (reação) tira o aviso e a não lida", () => {
  const { store, inner } = setup();
  inner.ingest(text("T1", "oi"), true);
  inner.ingest(undecrypted("R1"), true);
  assert.equal(store.getChat(PN)?.unread, 2);
  inner.ingest({ key: { remoteJid: PN, fromMe: false, id: "R1" }, message: { reactionMessage: { key: { remoteJid: PN, fromMe: false, id: "T1" }, text: "👍" } }, messageTimestamp: nowSec() - 30 }, true);
  assert.equal(store.getMessage(PN, "R1"), null);
  assert.equal(store.getChat(PN)?.unread, 1);
  assert.equal(store.getChat(PN)?.lastText, "oi");
});

test("reenvio do aviso mais antigo não tira da prévia o aviso mais novo", () => {
  const { store, inner } = setup();
  inner.ingest({ ...undecrypted("A1"), messageTimestamp: nowSec() - 60 }, true);
  inner.ingest(undecrypted("A2"), true);
  inner.ingest({ ...text("A1", "primeira"), messageTimestamp: nowSec() - 60 }, true);
  assert.equal(store.getMessage(PN, "A1")?.text, "primeira");
  assert.equal(store.getChat(PN)?.lastText, WAITING_TEXT);
});

test("mensagem que não decifrou no histórico não vira aviso", () => {
  const { store, inner } = setup();
  inner.ingest(undecrypted("H1"), false, true);
  assert.equal(store.getMessage(PN, "H1"), null);
});

test("abrir a conversa não manda recibo de leitura do aviso", () => {
  const { store, inner } = setup();
  inner.ingest(undecrypted("R1"), true);
  inner.ingest(text("R2", "oi"), true);
  assert.deepEqual(store.markRead(PN).map((k) => k.id), ["R2"]);
  assert.equal(store.getChat(PN)?.unread, 0);
});
