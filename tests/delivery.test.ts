import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { DeliveryLog, formatEntry } from "../server/delivery-log.ts";
import { createHandler } from "../server/http.ts";
import { WhatsApp } from "../server/whatsapp.ts";
import { fakeApi } from "./fake-api.ts";

const PN = "5511999990000@s.whatsapp.net";

/** Acesso aos métodos privados que o socket real chamaria. */
type Inner = {
  confirm(sent: unknown): Promise<{ key: { id: string } }>;
  applyAck(attrs: Record<string, string | undefined>): void;
  failPending(reason: string): void;
  tracked(kind: string, jid: string, run: () => Promise<string | null>): Promise<string | null>;
};

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-delivery-"));
  const store = new Store(join(dir, "inbox.db"));
  const wa = new WhatsApp(store, join(dir, "auth"));
  wa.ackTimeoutMs = 80;
  const sent = (id: string, text = "Oi") => ({ key: { remoteJid: PN, fromMe: true, id }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), status: 1 });
  return { store, wa, inner: wa as unknown as Inner, sent };
};

test("envio só conta como feito depois do ack do servidor: a mensagem fica com um tique", async () => {
  const { store, wa, inner, sent } = setup();
  const updates: number[] = [];
  wa.on("update", ({ message }) => updates.push(message.ack ?? -1));
  const waiting = inner.confirm(sent("A1"));
  // Já aparece na conversa (relógio), mas ainda não confirmada.
  assert.equal(store.getMessage(PN, "A1")?.ack, 1);
  inner.applyAck({ id: "A1", from: PN, class: "message" });
  assert.equal((await waiting).key.id, "A1");
  assert.equal(store.getMessage(PN, "A1")?.ack, 2);
  assert.deepEqual(updates, [2]);
});

test("ack com erro: a mensagem sai da conversa e o erro sobe", async () => {
  const { store, wa, inner, sent } = setup();
  const removed: string[] = [];
  wa.on("remove", ({ id }) => removed.push(id));
  const waiting = inner.confirm(sent("B1"));
  inner.applyAck({ id: "B1", from: PN, error: "463" });
  await assert.rejects(waiting, /bloqueou o envio/);
  assert.equal(store.getMessage(PN, "B1"), null);
  assert.deepEqual(removed, ["B1"]);
});

test("sem ack a tempo: sai da conversa; se o ack chegar atrasado, volta confirmada", async () => {
  const { store, wa, inner, sent } = setup();
  const removed: string[] = [];
  wa.on("remove", ({ id }) => removed.push(id));
  await assert.rejects(inner.confirm(sent("C1", "Chegou?")), /não confirmou o recebimento/);
  assert.equal(store.getMessage(PN, "C1"), null);
  assert.deepEqual(removed, ["C1"]);
  inner.applyAck({ id: "C1", from: PN });
  const back = store.getMessage(PN, "C1");
  assert.equal(back?.text, "Chegou?");
  assert.equal(back?.ack, 2);
});

test("queda da conexão rejeita os envios pendentes", async () => {
  const { store, inner, sent } = setup();
  const waiting = inner.confirm(sent("D1"));
  inner.failPending("A conexão com o WhatsApp caiu antes da confirmação.");
  await assert.rejects(waiting, /caiu antes da confirmação/);
  assert.equal(store.getMessage(PN, "D1"), null);
});

test("ack de outra stanza (reação, edição) não interfere", async () => {
  const { store, inner, sent } = setup();
  const waiting = inner.confirm(sent("E1"));
  inner.applyAck({ id: "OUTRA", from: PN });
  assert.equal(store.getMessage(PN, "E1")?.ack, 1);
  inner.applyAck({ id: "E1", from: PN });
  await waiting;
});

test("cada tentativa vira uma entrada de log, com sucesso ou erro", async () => {
  const { wa, inner } = setup();
  const entries: { kind: string; ok: boolean; error?: string; id?: string | null }[] = [];
  wa.on("delivery", (e) => entries.push(e));
  assert.equal(await inner.tracked("texto", PN, async () => "X1"), "X1");
  await assert.rejects(inner.tracked("imagem", PN, async () => { throw new Error("O WhatsApp não está conectado."); }), /não está conectado/);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => [e.kind, e.ok, e.id ?? null]), [["texto", true, "X1"], ["imagem", false, null]]);
  assert.equal(entries[1].error, "O WhatsApp não está conectado.");
});

test("log em arquivo: linha legível, mais recente primeiro, erro com motivo", () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-log-"));
  const log = new DeliveryLog(join(dir, "envios.log"));
  assert.deepEqual(log.tail(), []);
  log.record({ kind: "texto", jid: PN, id: "A1", ok: true, ms: 900 });
  log.record({ kind: "voz", jid: PN, id: null, ok: false, ms: 20_000, error: "O WhatsApp não confirmou\n o recebimento." });
  const lines = log.tail();
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}  ERRO  voz {7}5511999990000  id=-  20,0s  O WhatsApp não confirmou o recebimento\.$/);
  assert.match(lines[1], /  OK    texto {5}5511999990000  id=A1  0,9s$/);
  assert.equal(readFileSync(log.file, "utf8").split("\n").filter(Boolean).length, 2);
  assert.equal(log.tail(1).length, 1);
  assert.match(formatEntry({ kind: "enquete", jid: "123@g.us", ok: true, ms: 0 }), /enquete {3}123  id=-  0,0s$/);
});

test("GET /api/send-log devolve arquivo e linhas", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-log-http-"));
  const store = new Store(join(dir, "inbox.db"));
  const api = fakeApi(store, { sendLog: () => ({ file: "C:\\dados\\envios.log", lines: ["linha 1"] }) });
  const server = createServer(createHandler(api));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${api.port}`;
  try {
    const res = await fetch(`${base}/api/send-log`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { file: "C:\\dados\\envios.log", lines: ["linha 1"] });
  } finally {
    server.close();
  }
});
