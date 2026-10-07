import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { avatarCache } from "../server/avatars.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const okFetch = (async () => new Response(JPEG, { status: 200 })) as unknown as typeof fetch;

test("avatar: baixa, guarda e reaproveita por 24 h", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  const get = avatarCache(dir, async () => (calls++, "https://pps.whatsapp.net/x.jpg"), okFetch);
  const first = await get("5511999999999@s.whatsapp.net");
  assert.ok(first && first.endsWith(".jpg"));
  assert.deepEqual(readFileSync(first), JPEG);
  assert.equal(await get("5511999999999@s.whatsapp.net"), first);
  assert.equal(calls, 1);
});

test("avatar: sem foto fica em cache como ausente; expira depois de 24 h", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  let now = Date.now();
  const get = avatarCache(dir, async () => (calls++, null), okFetch, () => now);
  assert.equal(await get("g@g.us"), null);
  assert.equal(await get("g@g.us"), null);
  assert.equal(calls, 1);
  now += 25 * 60 * 60 * 1000;
  assert.equal(await get("g@g.us"), null);
  assert.equal(calls, 2);
});

test("avatar: falha da fonte ou do download devolve null e não grava ausência", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  const offline = avatarCache(dir, async () => {
    calls++;
    throw new Error("O WhatsApp não está conectado.");
  }, okFetch);
  assert.equal(await offline("a@s.whatsapp.net"), null);
  assert.equal(await offline("a@s.whatsapp.net"), null);
  assert.equal(calls, 2);
  const broken = avatarCache(dir, async () => "https://x/y.jpg", (async () => new Response("", { status: 404 })) as unknown as typeof fetch);
  assert.equal(await broken("b@s.whatsapp.net"), null);
});

test("avatar: chamadas simultâneas da mesma conversa fazem uma busca só", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-av-"));
  let calls = 0;
  const get = avatarCache(dir, async () => (calls++, "https://x/y.jpg"), okFetch);
  const [a, b] = await Promise.all([get("c@s.whatsapp.net"), get("c@s.whatsapp.net")]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  assert.ok(a && existsSync(a));
});
