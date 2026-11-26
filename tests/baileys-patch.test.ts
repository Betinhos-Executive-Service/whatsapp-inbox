import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import {
  Curve,
  decodeBinaryNode,
  encodeWAMessage,
  generateSignalPubKey,
  getBinaryNodeChild,
  initAuthCreds,
  makeWASocket,
  useMultiFileAuthState,
  type AuthenticationCreds,
  type BinaryNode,
  type SignalDataTypeMap,
  type SignalKeyStoreWithTransaction,
} from "@whiskeysockets/baileys";
import { makeLibSignalRepository } from "@whiskeysockets/baileys/lib/Signal/libsignal.js";
import pino from "pino";

// Testes das correções do patches/@whiskeysockets__baileys@7.0.0-rc14.patch. Nada sai para o WhatsApp:
// a criptografia roda em memória e o socket fala com um servidor WebSocket local.

const logger = pino({ level: process.env.BAILEYS_LOG ?? "silent" });

function memoryKeys(): SignalKeyStoreWithTransaction {
  const data: Record<string, Record<string, unknown>> = {};
  return {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) =>
      Object.fromEntries(ids.flatMap((id) => (data[type]?.[id] == null ? [] : [[id, data[type][id]]]))) as Record<string, SignalDataTypeMap[T]>,
    set: async (update) => {
      for (const [type, entries] of Object.entries(update)) {
        const bucket = (data[type] ??= {});
        for (const [id, value] of Object.entries(entries ?? {})) {
          if (value == null) delete bucket[id];
          else bucket[id] = value;
        }
      }
    },
    clear: async () => undefined,
    transaction: async (work) => work(),
    isInTransaction: () => false,
  };
}

/** Um aparelho com identidade, pré-chave assinada e pré-chaves próprias, como o Baileys guarda. */
function device() {
  const creds = initAuthCreds();
  const keys = memoryKeys();
  const repo = makeLibSignalRepository({ creds, keys }, logger);
  let nextPreKey = 1;
  /** O pacote que o outro lado usa para abrir uma sessão nova com este aparelho. */
  const bundle = async () => {
    const keyId = nextPreKey++;
    const preKey = Curve.generateKeyPair();
    await keys.set({ "pre-key": { [keyId]: preKey } });
    return {
      registrationId: creds.registrationId,
      identityKey: generateSignalPubKey(creds.signedIdentityKey.public),
      signedPreKey: {
        keyId: creds.signedPreKey.keyId,
        publicKey: generateSignalPubKey(creds.signedPreKey.keyPair.public),
        signature: creds.signedPreKey.signature,
      },
      preKey: { keyId, publicKey: generateSignalPubKey(preKey.public) },
    };
  };
  return { creds, keys, repo, bundle };
}

const BOB_PN = "5511988887777@s.whatsapp.net";
const BOB_LID = "123450000007777@lid";
const ME_PN = "5511900001111@s.whatsapp.net";
const ME_LID = "987650000001111@lid";
const bytes = (s: string) => Buffer.from(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("migração Número→LID junta a sessão do número com a que o LID já tinha", async () => {
  const me = device();
  const bob = device();

  // Bob abre a sessão do LID, e nós respondemos nela (assim as próximas dele saem como "msg").
  await bob.repo.injectE2ESession({ jid: ME_LID, session: await me.bundle() });
  const first = await bob.repo.encryptMessage({ jid: ME_LID, data: bytes("oi pelo LID") });
  assert.equal(text(await me.repo.decryptMessage({ jid: BOB_LID, ...first })), "oi pelo LID");
  const reply = await me.repo.encryptMessage({ jid: BOB_LID, data: bytes("recebido") });
  assert.equal(text(await bob.repo.decryptMessage({ jid: ME_LID, ...reply })), "recebido");

  // Uma sessão antiga pelo número, que a migração leva para o LID.
  await bob.repo.injectE2ESession({ jid: ME_PN, session: await me.bundle() });
  const old = await bob.repo.encryptMessage({ jid: ME_PN, data: bytes("oi pelo número") });
  assert.equal(text(await me.repo.decryptMessage({ jid: BOB_PN, ...old })), "oi pelo número");
  await me.keys.set({ "device-list": { "5511988887777": ["0"] } });

  const result = await me.repo.migrateSession(BOB_PN, BOB_LID);
  assert.equal(result.migrated, 1);

  // Sem a correção, a sessão do LID era sobrescrita e esta falhava com "No matching sessions found for message".
  const next = await bob.repo.encryptMessage({ jid: ME_LID, data: bytes("depois da migração") });
  assert.equal(next.type, "msg");
  assert.equal(text(await me.repo.decryptMessage({ jid: BOB_LID, ...next })), "depois da migração");

  const record = await me.keys.get("session", [me.repo.jidToSignalProtocolAddress(BOB_LID)]);
  const sessions = Object.values((Object.values(record)[0] as unknown as { _sessions: Record<string, { indexInfo: { closed: number } }> })._sessions);
  assert.equal(sessions.length, 2, "as duas sessões ficam no registro");
  assert.equal(sessions.filter((s) => s.indexInfo.closed === -1).length, 1, "só uma fica aberta para envio");
  assert.deepEqual(await me.keys.get("session", [me.repo.jidToSignalProtocolAddress(BOB_PN)]), {}, "a do número sai");
});

type Device = ReturnType<typeof device>;

/** Bob com duas sessões com a gente, cada uma com mensagem e resposta: uma pelo LID e outra, mais recente, pelo número. */
async function twoSessions(me: Device, bob: Device) {
  for (const [mine, his] of [
    [ME_LID, BOB_LID],
    [ME_PN, BOB_PN],
  ]) {
    await bob.repo.injectE2ESession({ jid: mine, session: await me.bundle() });
    const hello = await bob.repo.encryptMessage({ jid: mine, data: bytes("oi") });
    assert.equal(text(await me.repo.decryptMessage({ jid: his, ...hello })), "oi");
    await bob.repo.decryptMessage({ jid: mine, ...(await me.repo.encryptMessage({ jid: his, data: bytes("recebido") })) });
    await sleep(5); // o libsignal tenta as sessões do registro pela última vez em que cada uma decifrou (ms)
  }
  await me.keys.set({ "device-list": { "5511988887777": ["0"] } });
}

/** Bob decifra a nossa resposta no registro em que ele tiver a sessão certa. */
async function bobReads(bob: Device, reply: { type: "pkmsg" | "msg"; ciphertext: Uint8Array }) {
  for (const jid of [ME_PN, ME_LID]) {
    try {
      return text(await bob.repo.decryptMessage({ jid, ...reply }));
    } catch {
      // tenta o outro registro
    }
  }
  return "não decifrou";
}

test("sessão mesclada: mensagens cruzadas entre a sessão do número e a do LID não estragam a outra", async () => {
  const me = device();
  const bob = device();
  await twoSessions(me, bob);
  assert.equal((await me.repo.migrateSession(BOB_PN, BOB_LID)).migrated, 1);

  const fromBob = async (via: string, body: string) => {
    const msg = await bob.repo.encryptMessage({ jid: via, data: bytes(body) });
    assert.equal(msg.type, "msg");
    return text(await me.repo.decryptMessage({ jid: BOB_LID, ...msg }));
  };
  // Sem o patch do libsignal, a tentativa na sessão errada ficava gravada e a P3 falhava com
  // "No matching sessions found for message"; a nossa resposta também não decifrava do lado do Bob.
  assert.equal(await fromBob(ME_PN, "P2"), "P2");
  await sleep(5);
  assert.equal(await fromBob(ME_LID, "L3"), "L3");
  assert.equal(await fromBob(ME_PN, "P3"), "P3");
  assert.equal(await fromBob(ME_LID, "L4"), "L4");
  assert.equal(await bobReads(bob, await me.repo.encryptMessage({ jid: BOB_LID, data: bytes("resposta") })), "resposta");
});

// ---------- socket contra um servidor WebSocket local ----------

/** Servidor que aceita a conexão e nunca completa o handshake: o Baileys manda os nós sem cifrar. */
async function fakeServer() {
  const { WebSocketServer } = createRequire(createRequire(import.meta.url).resolve("@whiskeysockets/baileys"))("ws");
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => wss.once("listening", r));
  const nodes: BinaryNode[] = [];
  let hello = true;
  wss.on("connection", (socket: { on(e: "message", cb: (data: Buffer) => void): void }) => {
    socket.on("message", (data) => {
      // O primeiro frame é o "client hello" do handshake (protobuf com cabeçalho), não um nó.
      if (hello) return void (hello = false);
      void decodeBinaryNode(data.subarray(3)).then((node) => nodes.push(node));
    });
  });
  return { url: `ws://127.0.0.1:${wss.address().port}`, nodes, close: () => wss.close() };
}

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 200 && !check(); i++) await sleep(10);
  assert.ok(check(), what);
}

async function socketWithServer(creds: AuthenticationCreds = initAuthCreds(), keys: SignalKeyStoreWithTransaction = memoryKeys()) {
  const server = await fakeServer();
  const sock = makeWASocket({
    auth: { creds, keys },
    logger,
    waWebSocketUrl: server.url,
    markOnlineOnConnect: false,
    connectTimeoutMs: 5_000,
    defaultQueryTimeoutMs: 200,
  });
  const own = new Set(sock.ws.listeners("frame"));
  await waitFor(() => sock.ws.isOpen, "socket abriu");
  await sleep(50);
  // Tira quem espera a resposta do handshake, senão o primeiro nó emitido derruba a conexão.
  for (const listener of sock.ws.listeners("frame")) if (!own.has(listener)) sock.ws.off("frame", listener as () => void);
  return { sock, server, stop: () => (sock.end(undefined), server.close()) };
}

const offlineRequests = (nodes: BinaryNode[]) => nodes.filter((n) => n.tag === "ib" && getBinaryNodeChild(n, "offline_batch")).length;

test("fila offline: pede o próximo lote a cada 100 itens e a cada 10 s, até o aviso de fim", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { sock, server, stop } = await socketWithServer();
  try {
    const emit = (event: string, node: BinaryNode) => sock.ws.emit(event, node);
    emit("CB:ib,,offline_preview", { tag: "ib", attrs: {}, content: [{ tag: "offline_preview", attrs: { count: "250" } }] });
    await waitFor(() => offlineRequests(server.nodes) === 1, "1º pedido na prévia");

    for (let i = 0; i < 100; i++) emit("frame", { tag: "message", attrs: { id: `M${i}`, offline: "1" } });
    await waitFor(() => offlineRequests(server.nodes) === 2, "2º pedido depois de 100 itens");

    mock.timers.tick(10_000);
    await waitFor(() => offlineRequests(server.nodes) === 3, "3º pedido depois de 10 s sem o fim");

    emit("CB:ib,,offline", { tag: "ib", attrs: {}, content: [{ tag: "offline", attrs: { count: "250" } }] });
    for (let i = 0; i < 100; i++) emit("frame", { tag: "message", attrs: { id: `N${i}`, offline: "1" } });
    mock.timers.tick(30_000);
    await sleep(100);
    assert.equal(offlineRequests(server.nodes), 3, "nenhum pedido depois do aviso de fim");
  } finally {
    stop();
    mock.timers.reset();
  }
});

const ME = { id: "5511900001111:7@s.whatsapp.net", lid: "987650000001111:7@lid", name: "teste" };
const isRetryReceipt = (n: BinaryNode) => n.tag === "receipt" && n.attrs.type === "retry";

/** Mensagem como o servidor entrega: o `enc` com o que o Bob cifrou. */
function messageNode(id: string, attrs: Record<string, string>, enc: { type: "pkmsg" | "msg"; ciphertext: Uint8Array }): BinaryNode {
  return {
    tag: "message",
    attrs: { id, t: String(Math.floor(Date.now() / 1000)), type: "text", notify: "Bob", ...attrs },
    content: [{ tag: "enc", attrs: { type: enc.type, v: "2" }, content: enc.ciphertext }],
  };
}

test("migração Número→LID na fila da decifragem: a sessão nova que o LID acabou de gravar não some", async () => {
  const me = device();
  me.creds.me = ME;
  const bob = device();
  await twoSessions(me, bob);

  // Bob abre uma sessão nova pelo LID (A) e, ao mesmo tempo, chega uma pelo número com o LID dele (B), que faz o
  // app aprender o mapeamento e migrar. Gravar sessão leva um tempo, como no disco.
  await bob.repo.injectE2ESession({ jid: ME_LID, session: await me.bundle() });
  const a = await bob.repo.encryptMessage({ jid: ME_LID, data: encodeWAMessage({ conversation: "nova pelo LID" }) });
  const b = await bob.repo.encryptMessage({ jid: ME_PN, data: encodeWAMessage({ conversation: "pelo número" }) });
  assert.deepEqual([a.type, b.type], ["pkmsg", "msg"]);
  const set = me.keys.set;
  me.keys.set = async (update) => {
    if (update.session) await sleep(50);
    return set(update);
  };

  const { sock, server, stop } = await socketWithServer(me.creds, me.keys);
  try {
    sock.ws.emit("CB:message", messageNode("3EB0AAAA", { from: BOB_LID }, a));
    sock.ws.emit("CB:message", messageNode("3EB0BBBB", { from: BOB_PN, sender_lid: BOB_LID }, b));
    // O recibo de entrega só sai depois de decifrar e gravar.
    const delivered = (id: string) => server.nodes.some((n) => n.tag === "receipt" && n.attrs.id === id && n.attrs.type !== "retry");
    for (let i = 0; i < 500 && !(delivered("3EB0AAAA") && delivered("3EB0BBBB")); i++) await sleep(10);
    assert.ok(delivered("3EB0AAAA") && delivered("3EB0BBBB"), "as duas mensagens decifraram");
    await sleep(200);
    assert.equal(server.nodes.filter(isRetryReceipt).length, 0, "nenhuma das duas precisou de reenvio");
  } finally {
    stop();
  }

  // Sem a correção, a migração gravava o merge feito com o LID de antes da sessão nova: a sessão nova (ou a do
  // número) sumia, e a próxima mensagem nela falhava.
  me.keys.set = set;
  const fromBob = async (via: string, body: string) =>
    text(await me.repo.decryptMessage({ jid: BOB_LID, ...(await bob.repo.encryptMessage({ jid: via, data: bytes(body) })) }));
  assert.equal(await fromBob(ME_LID, "de novo pelo LID"), "de novo pelo LID");
  assert.equal(await fromBob(ME_PN, "de novo pelo número"), "de novo pelo número");
});

test("reenvio: o recibo só sai depois de gravar a pré-chave que ele leva", async () => {
  const creds = initAuthCreds();
  creds.me = ME;
  const keys = memoryKeys();
  let release!: () => void;
  const disk = new Promise<void>((resolve) => (release = resolve));
  let preKeySaved = false;
  const set = keys.set;
  keys.set = async (update) => {
    if (update["pre-key"]) {
      await disk;
      preKeySaved = true;
    }
    return set(update);
  };
  const { sock, server, stop } = await socketWithServer(creds, keys);
  try {
    sock.ws.emit("CB:message", messageNode("3EB0FALHA2", { from: BOB_LID }, { type: "msg", ciphertext: Buffer.alloc(40, 7) }));
    await sleep(500);
    // Sem a correção o recibo saía antes do commit: uma queda aqui deixava o contato com uma pré-chave que não existe.
    assert.equal(server.nodes.filter(isRetryReceipt).length, 0, "nenhum recibo antes de a pré-chave estar gravada");
    release();
    await waitFor(() => server.nodes.some(isRetryReceipt), "recibo enviado depois da gravação");
    assert.ok(preKeySaved);
  } finally {
    release();
    stop();
  }
});

test("reenvio: o 1º recibo de reenvio já leva as nossas chaves", async () => {
  const creds = initAuthCreds();
  creds.me = ME;
  const { sock, server, stop } = await socketWithServer(creds);
  try {
    // Mensagem de um contato que não decifra (sem sessão nenhuma com ele).
    sock.ws.emit("CB:message", messageNode("3EB0FALHA", { from: BOB_LID }, { type: "msg", ciphertext: Buffer.alloc(40, 7) }));
    await waitFor(() => server.nodes.some(isRetryReceipt), "recibo de reenvio enviado");
    const receipt = server.nodes.find(isRetryReceipt)!;
    assert.equal(getBinaryNodeChild(receipt, "retry")?.attrs.count, "1");
    assert.ok(getBinaryNodeChild(receipt, "keys"), "chaves no 1º pedido");
  } finally {
    stop();
  }
});

test("chaves: gravação atômica, a escrita que falha não estraga o arquivo que já estava salvo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-auth-"));
  const { state } = await useMultiFileAuthState(dir);
  const first = Curve.generateKeyPair();
  await state.keys.set({ "pre-key": { 1: first } });
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), [], "nenhum temporário fica para trás");

  // Força a falha no meio da escrita: um diretório no caminho do temporário.
  mkdirSync(join(dir, "pre-key-1.json.tmp"));
  await assert.rejects(async () => state.keys.set({ "pre-key": { 1: Curve.generateKeyPair() } }));
  const saved = (await state.keys.get("pre-key", ["1"]))["1"];
  assert.deepEqual(Buffer.from(saved!.public), Buffer.from(first.public), "o arquivo antigo continua inteiro");
});

test("chaves: com o arquivo preso por ~0,6 s (antivírus no Windows), ainda grava pelo temporário", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-auth-"));
  const { state } = await useMultiFileAuthState(dir);
  const fsp = createRequire(import.meta.url)("node:fs/promises") as typeof import("node:fs/promises");
  const realRename = fsp.rename;
  const lockedUntil = Date.now() + 600;
  let renamed = false;
  const locked = mock.method(fsp, "rename", async (from: string, to: string) => {
    if (Date.now() < lockedUntil) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    await realRename(from, to);
    renamed = true;
  });
  syncBuiltinESMExports();
  try {
    await state.keys.set({ "pre-key": { 1: Curve.generateKeyPair() } });
  } finally {
    locked.mock.restore();
    syncBuiltinESMExports();
  }
  // Com só ~150 ms de novas tentativas, caía na gravação direta, não atômica.
  assert.ok(renamed, "a troca pelo rename aconteceu depois que o arquivo foi liberado");
  assert.ok((await state.keys.get("pre-key", ["1"]))["1"], "a chave ficou gravada");
});
