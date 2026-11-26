import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { Store } from "../server/db.ts";
import { WhatsApp } from "../server/whatsapp.ts";

const PN = "5512999990000@s.whatsapp.net";

/** Caminho que o socket real percorre ao entregar a fila offline (messages.upsert com várias mensagens). */
type Inner = { ingestAll(list: unknown[], live: boolean, quiet?: boolean, offline?: boolean): number };

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-offline-"));
  const store = new Store(join(dir, "inbox.db"));
  const wa = new WhatsApp(store, join(dir, "auth"));
  return { store, wa, inner: wa as unknown as Inner };
};

const nowSec = () => Math.floor(Date.now() / 1000);
const text = (id: string, body: string, at: number) => ({ key: { remoteJid: PN, fromMe: false, id }, message: { conversation: body }, messageTimestamp: at });

test("fila offline: erro numa mensagem não faz as seguintes do lote se perderem", () => {
  const { store, wa, inner } = setup();
  const stderr = mock.method(process.stderr, "write", () => true);
  // Quem ouve a mensagem nova (notificação, classificação) quebra na segunda.
  wa.on("message", ({ message }) => {
    if (message.id === "B") throw new Error("falha no aviso");
  });
  const at = nowSec() - 600;
  const failed = inner.ingestAll([text("A", "um", at), text("B", "dois", at + 1), text("C", "três", at + 2)], true);
  stderr.mock.restore();
  assert.equal(failed, 1);
  assert.deepEqual(store.listMessages(PN, null).map((m) => m.id), ["A", "B", "C"]);
  assert.equal(store.getChat(PN)!.unread, 3);
});

test("mensagem que não decifrou fica como aviso e vai para o log", () => {
  const { store, inner } = setup();
  const lines: string[] = [];
  const stderr = mock.method(process.stderr, "write", (s: string) => (lines.push(String(s)), true));
  inner.ingestAll([{ key: { remoteJid: PN, fromMe: false, id: "X" }, messageStubType: 2, messageStubParameters: ["Bad MAC"], messageTimestamp: nowSec() }], true);
  stderr.mock.restore();
  assert.equal(store.getMessage(PN, "X")?.kind, "system");
  assert.ok(lines.some((l) => l.includes("X") && l.includes("não decifrou")));
});

test("fila offline (append) conta como não lida mas sai marcada como offline, sem virar notificação", () => {
  const { store, wa, inner } = setup();
  const events: { id: string; live: boolean; offline?: boolean }[] = [];
  wa.on("message", ({ message, live, offline }) => events.push({ id: message.id, live, offline }));
  const at = nowSec() - 3600;
  inner.ingestAll([text("O1", "enquanto fechado", at), text("O2", "outra", at + 5)], true, false, true);
  inner.ingestAll([text("N1", "agora", nowSec())], true);
  assert.deepEqual(events, [
    { id: "O1", live: true, offline: true },
    { id: "O2", live: true, offline: true },
    { id: "N1", live: true, offline: false },
  ]);
  assert.equal(store.getChat(PN)!.unread, 3);
});
