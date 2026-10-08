import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { Store, type IncomingMessage } from "../server/db.ts";
import { firstUrl, isPrivateIp, parseMeta } from "../server/link-preview.ts";
import { decryptVote, encryptVote, optionsFromHashes } from "../server/poll.ts";
import { callText, ephemeralChange, ephemeralLabel, extractExtra, extractPin, extractText, parseVcard } from "../server/text.ts";
import { parseLocation, phoneDigits } from "../ui/location.ts";

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

test("enquete, localização, contato, evento, convite e prévia de link viram dados ricos", () => {
  const secret = new Uint8Array([1, 2, 3]);
  const poll = extractExtra({ pollCreationMessageV3: { name: "Horário?", options: [{ optionName: "7h" }, { optionName: "8h" }], selectableOptionsCount: 1 }, messageContextInfo: { messageSecret: secret } });
  assert.deepEqual(poll, { type: "poll", question: "Horário?", options: ["7h", "8h"], selectable: 1, secret: Buffer.from(secret).toString("base64") });

  assert.deepEqual(extractExtra({ locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: "Congonhas" } }), {
    type: "location", lat: -23.5, lng: -46.6, name: "Congonhas", address: null, url: null, live: false,
  });
  assert.equal(extractExtra({ locationMessage: { name: "sem coordenadas" } }), null);

  const contact = extractExtra({ contactMessage: { displayName: "Ana", vcard: "BEGIN:VCARD\nFN:Ana Souza\nitem1.TEL;waid=5511988887777:+55 11 98888-7777\nEND:VCARD" } });
  assert.deepEqual(contact, { type: "contact", contacts: [{ name: "Ana", phones: [{ number: "+5511988887777", waid: "5511988887777" }] }] });
  assert.equal(parseVcard("BEGIN:VCARD\nFN:Bia\nEND:VCARD").phones.length, 0);

  const event = extractExtra({ eventMessage: { name: "Reunião", startTime: 1_800_000_000, location: { name: "Sede" }, isCanceled: false } });
  assert.equal(event?.type === "event" && event.start, 1_800_000_000_000);

  const invite = extractExtra({ groupInviteMessage: { groupJid: "123@g.us", inviteCode: "abc", groupName: "Equipe", inviteExpiration: 1_900_000_000 } });
  assert.equal(invite?.type === "invite" && invite.code, "abc");

  const link = extractExtra({ extendedTextMessage: { text: "veja https://x.com", matchedText: "https://x.com", title: "X", description: "Site" } });
  assert.deepEqual(link, { type: "link", url: "https://x.com", title: "X", description: "Site", thumb: null });
  assert.equal(extractExtra({ extendedTextMessage: { text: "sem prévia" } }), null);
});

test("ligação: registro do celular vira texto; pin e temporárias são ações, não mensagem", () => {
  assert.deepEqual(extractText({ callLogMesssage: { isVideo: true, callOutcome: 1 } }), { text: "Chamada de vídeo perdida", kind: "call" });
  assert.equal(callText({ video: false, outcome: "missed", seconds: null, group: false, outgoing: true }), "Chamada de voz não atendida");
  assert.equal(callText({ video: false, outcome: "connected", seconds: 185, group: false, outgoing: false }), "Chamada de voz · 3 min");

  assert.deepEqual(extractPin({ pinInChatMessage: { key: { id: "A" }, type: 1 }, messageContextInfo: { messageAddOnDurationInSecs: 86400 } }), { id: "A", pin: true, seconds: 86400 });
  assert.equal(extractPin({ pinInChatMessage: { key: { id: "A" }, type: 2 } })?.pin, false);
  assert.equal(extractText({ pinInChatMessage: { key: { id: "A" }, type: 1 } }), null);

  assert.equal(ephemeralChange({ protocolMessage: { type: 3, ephemeralExpiration: 604800 } }), 604800);
  assert.equal(ephemeralChange({ protocolMessage: { type: 3 } }), 0);
  assert.equal(ephemeralChange({ protocolMessage: { type: 0 } }), null);
  assert.equal(ephemeralLabel(86400), "24 horas");
  assert.equal(ephemeralLabel(7776000), "90 dias");
});

test("voto de enquete: cifra e decifra com JID em número ou LID; hash desconhecido é ignorado", () => {
  const secret = randomBytes(32);
  const enc = encryptVote(["8h"], { secret, pollId: "P1", creator: PN, voter: "999@lid" });
  const hashes = decryptVote(enc, { secret, pollId: "P1", creators: ["111@lid", PN], voters: ["5511@s.whatsapp.net", "999@lid"] });
  assert.ok(hashes);
  assert.deepEqual(optionsFromHashes(["7h", "8h"], hashes), ["8h"]);
  assert.equal(decryptVote(enc, { secret, pollId: "P2", creators: [PN], voters: ["999@lid"] }), null, "outra enquete não decifra");
});

test("votos somados por opção, com o meu marcado; trocar e tirar o voto", () => {
  const s = new Store(":memory:");
  const extra = JSON.stringify({ type: "poll", question: "Horário?", options: ["7h", "8h"], selectable: 0, secret: "c2VncmVkbw==" });
  s.addMessage(msg({ id: "poll", kind: "poll", text: "[Enquete] Horário?", extra }), false);
  s.recordVote(PN, "poll", "me", ["7h"], 1);
  s.recordVote(PN, "poll", "5511888880000@s.whatsapp.net", ["7h", "8h"], 2);
  let m = s.getMessage(PN, "poll")!;
  assert.equal(m.extra?.type === "poll" && "secret" in m.extra ? m.extra.secret : null, null, "o segredo não vai para a tela");
  assert.deepEqual(m.poll?.options.map((o) => [o.name, o.count, o.mine]), [["7h", 2, true], ["8h", 1, false]]);
  assert.equal(m.poll?.voters, 2);
  assert.equal(s.pollRef(PN, "poll")?.poll.secret, "c2VncmVkbw==");

  s.recordVote(PN, "poll", "me", ["8h"], 3);
  s.recordVote(PN, "poll", "5511888880000@s.whatsapp.net", [], 4);
  m = s.getMessage(PN, "poll")!;
  assert.deepEqual(m.poll?.options.map((o) => [o.name, o.count, o.mine]), [["7h", 0, false], ["8h", 1, true]]);
  assert.equal(m.poll?.voters, 1);
  assert.equal(s.recordVote(PN, "poll", "me", ["7h"], 2)?.poll?.options[0].mine, false, "voto mais antigo não sobrescreve o novo");
});

test("fixar, favoritar, não lida, temporárias e avisos que não contam como não lida", () => {
  const s = new Store(":memory:");
  s.addMessage(msg({ id: "a", text: "Carro às 7h", at: 1000 }), false);

  const pinned = s.setPin(PN, "a", Date.now() + 86400_000)!;
  assert.deepEqual(pinned.pins.map((p) => [p.id, p.text]), [["a", "Carro às 7h"]]);
  assert.equal(s.setPin(PN, "a", null)!.pins.length, 0);
  s.setPin(PN, "a", Date.now() - 1);
  assert.equal(s.getChat(PN)!.pins.length, 0, "fixada vencida some");

  assert.equal(s.setStarred(PN, "a", true)?.starred, true);
  assert.equal(s.setStarred(PN, "a", true), null, "sem mudança devolve null");
  assert.deepEqual(s.listStarred().map((m) => m.id), ["a"]);

  s.updateChat(PN, { markedUnread: true });
  assert.equal(s.getChat(PN)!.markedUnread, true);
  assert.equal(s.clearMarkedUnread(PN), true);
  assert.equal(s.clearMarkedUnread(PN), false);

  assert.equal(s.setEphemeral(PN, 86400)!.ephemeral, 86400);
  assert.equal(s.setEphemeral(PN, null)!.ephemeral, null);

  s.updateChat(PN, { status: "resolvida" });
  s.addMessage(msg({ id: "n", text: "Ana entrou no grupo", kind: "system", silent: true }), true);
  assert.equal(s.getChat(PN)!.unread, 0);
  assert.equal(s.getChat(PN)!.status, "resolvida");
  assert.equal(s.getChat(PN)!.lastText, "Ana entrou no grupo");
});

test("ligação: aviso ao vivo vira perdida e conta como não lida; registro duplicado é detectado", () => {
  const s = new Store(":memory:");
  const at = Date.now();
  s.addMessage(msg({ id: "call-1", kind: "call", text: "Chamada de voz recebida. Atenda no celular.", at, silent: true }), true);
  assert.equal(s.getChat(PN)!.unread, 0);
  const done = s.updateCall(PN, "call-1", "Chamada de voz perdida", JSON.stringify({ type: "call", video: false, outcome: "missed", seconds: null, group: false, outgoing: false }), true)!;
  assert.equal(done.message.text, "Chamada de voz perdida");
  assert.equal(done.chat.unread, 1);
  assert.equal(done.chat.status, "aberta");
  assert.equal(s.hasCallNear(PN, at + 60_000), true);
  assert.equal(s.hasCallNear(PN, at + 10 * 60_000), false);
  assert.equal(s.updateCall(PN, "nao-existe", "x", "{}", true), null);
});

test("conversa nova entra na lista; figurinhas repetidas aparecem uma vez", () => {
  const s = new Store(":memory:");
  const jid = "5511777770000@s.whatsapp.net";
  assert.equal(s.listChats().length, 0);
  assert.equal(s.openChat(jid).jid, jid);
  assert.deepEqual(s.listChats().map((c) => c.jid), [jid]);

  const sticker = (id: string, size: number) => msg({ id, kind: "sticker", text: "[Figurinha]", media: JSON.stringify({ type: "sticker", mimetype: "image/webp", size, mediaKey: "x", directPath: "/p" }) });
  s.addMessage(sticker("s1", 100), false);
  s.addMessage(sticker("s2", 100), false);
  s.addMessage(sticker("s3", 200), false);
  assert.equal(s.listStickers().length, 2);
});

test("prévia de link: primeiro link, endereço interno bloqueado e metadados da página", () => {
  assert.deepEqual(firstUrl("veja www.betinhos.com.br."), { matched: "www.betinhos.com.br", url: "https://www.betinhos.com.br" });
  assert.equal(firstUrl("sem link"), null);
  assert.ok(isPrivateIp("127.0.0.1") && isPrivateIp("192.168.0.10") && isPrivateIp("10.1.2.3") && isPrivateIp("::1") && isPrivateIp("::ffff:172.16.0.1"));
  assert.ok(!isPrivateIp("8.8.8.8") && !isPrivateIp("2804:14c::1"));
  const meta = parseMeta(`<html><head><title>Antigo</title><meta content="Betinhos &amp; Cia" property="og:title"><meta name="description" content='Transporte executivo'><meta property="og:image" content="/logo.jpg"></head></html>`);
  assert.deepEqual(meta, { title: "Betinhos & Cia", description: "Transporte executivo", image: "/logo.jpg", url: null });
  assert.equal(parseMeta("<title> Só título </title>").title, "Só título");
});

test("localização colada e número digitado", () => {
  assert.deepEqual(parseLocation("-23.5505, -46.6333"), { lat: -23.5505, lng: -46.6333 });
  assert.deepEqual(parseLocation("https://www.google.com/maps/place/X/@-23.6261,-46.6564,17z/data=!3d-23.6262!4d-46.6565"), { lat: -23.6262, lng: -46.6565 });
  assert.deepEqual(parseLocation("https://maps.google.com/?q=-22.9,-43.2"), { lat: -22.9, lng: -43.2 });
  assert.equal(parseLocation("Rua Augusta, 100"), null);
  assert.equal(parseLocation("123, 456"), null);
  assert.equal(phoneDigits("(11) 99999-0000"), "5511999990000");
  assert.equal(phoneDigits("+1 415 555 0100"), "14155550100");
  assert.equal(phoneDigits("123"), null);
});
