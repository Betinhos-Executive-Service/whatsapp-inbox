import assert from "node:assert/strict";
import { test } from "node:test";
import { linkFromArgv, parseWaLink } from "../desktop/wa-link.ts";

const TEXT = "Olá, Fabrizio! Aqui é da Betinhos.\n\nSegue o recibo (PAG-1973, R$ 1.491,06):\nhttps://exemplo.com/a?b=1";
const QUERY = new URLSearchParams({ phone: "393371274871", text: TEXT }).toString();

test("whatsapp:// e whatsapp-inbox:// viram número e texto", () => {
  for (const url of [`whatsapp://send?${QUERY}`, `whatsapp://send/?${QUERY}&type=phone_number&app_absent=0`, `whatsapp-inbox://send?${QUERY}`, `WhatsApp://send?${QUERY}`]) {
    assert.deepEqual(parseWaLink(url), { phone: "393371274871", text: TEXT }, url);
  }
});

test("links web do WhatsApp também valem", () => {
  assert.deepEqual(parseWaLink(`https://api.whatsapp.com/send/?${QUERY}&type=phone_number&app_absent=0`), { phone: "393371274871", text: TEXT });
  assert.deepEqual(parseWaLink(`https://web.whatsapp.com/send?${QUERY}`), { phone: "393371274871", text: TEXT });
  assert.deepEqual(parseWaLink("https://wa.me/5511987654321?text=oi"), { phone: "5511987654321", text: "oi" });
});

test("sem texto, rascunho vazio; número com símbolos vira só dígitos", () => {
  assert.deepEqual(parseWaLink("whatsapp://send?phone=%2B55%20(11)%2098765-4321"), { phone: "5511987654321", text: "" });
});

test("recusa o que não é link de conversa", () => {
  for (const url of [
    "whatsapp://send",
    "whatsapp://send?phone=123",
    "whatsapp://chat?phone=5511987654321",
    "https://exemplo.com/send?phone=5511987654321",
    "https://api.whatsapp.com/outra?phone=5511987654321",
    "https://wa.me/",
    "file:///C:/x.exe",
    "--hidden",
    "não é url",
  ]) {
    assert.equal(parseWaLink(url), null, url);
  }
});

test("acha o link entre os argumentos do Windows", () => {
  const argv = ["C:\\Program Files\\WhatsApp Inbox\\WhatsApp Inbox.exe", "--allow-file-access-from-files", `whatsapp://send/?${QUERY}`];
  assert.deepEqual(linkFromArgv(argv), { phone: "393371274871", text: TEXT });
  assert.equal(linkFromArgv(["app.exe", "--hidden"]), null);
});
