// Falhas de envio simuladas na tela, sem WhatsApp: finge "Conectado" só no navegador, intercepta o POST de envio
// e dispara os eventos que o servidor mandaria (inbox:message / inbox:remove / inbox:update).
// Uso: servidor no ar com WA_DISABLED=1 e ao menos 2 conversas; PLAYWRIGHT_CORE=<pasta> node envio-falhas.mjs <pasta-de-saída>
// Esperado: B fim e F com "falha":true; B2 com "falha":false e 1 bolha; E [false,true] -> [true,false];
// C, D e G "de volta" com o texto em "campo" e 0 bolhas.
import { createRequire } from "node:module";
// PLAYWRIGHT_CORE = pasta que contém node_modules/playwright-core (ex.: ~/.npm/_npx/<hash>).
const require = createRequire(`${process.env.PLAYWRIGHT_CORE}/node_modules/`);
const { chromium } = require("playwright-core");
const out = process.argv[2];
const b = await chromium.launch();
async function open(on = true) {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: "pt-BR" });
  const p = await c.newPage();
  if (on) {
    await p.addInitScript(() => {
      const fix = (o) => { const c = o.connection ?? o; c.status = "conectado"; return o; };
      const add = EventSource.prototype.addEventListener;
      EventSource.prototype.addEventListener = function (t, fn, ...r) {
        if (t === "state") return add.call(this, t, (e) => fn({ data: JSON.stringify(fix(JSON.parse(e.data))) }), ...r);
        if (t === "connection") return add.call(this, t, (e) => fn({ data: JSON.stringify(fix({ connection: JSON.parse(e.data) }).connection) }), ...r);
        return add.call(this, t, fn, ...r);
      };
    });
    await p.route("**/api/state", async (r) => { const res = await r.fetch(); const j = await res.json(); j.connection.status = "conectado"; await r.fulfill({ response: res, json: j }); });
  }
  await p.goto("http://127.0.0.1:38291/");
  await p.waitForSelector(".chat-item__name");
  const rq = p.waitForRequest((r) => /\/messages/.test(r.url()));
  await p.locator(".chat-item").first().click();
  p.jid = decodeURIComponent((await rq).url().match(/chats\/([^/]+)\/messages/)[1]);
  await p.waitForTimeout(800);
  return p;
}
const state = (p, txt) => p.evaluate((t) => {
  const bs = [...document.querySelectorAll(".bubble")].filter((x) => x.textContent.includes(t));
  return { bolhas: bs.length, falha: bs.some((x) => x.querySelector(".bubble__retry")), campo: document.querySelector("textarea")?.value ?? null, toast: [...document.querySelectorAll('[role=alert],[role=status],.toast')].map((x) => x.textContent.trim().slice(0, 120)).filter(Boolean) };
}, txt);
const type = async (p, t) => { await p.locator("textarea").first().fill(t); await p.keyboard.press("Enter"); };

// A: servidor real, WhatsApp desligado (erro imediato)
let p = await open(false);
console.log("A offline: campo desabilitado =", await p.locator("textarea").first().isDisabled(), "| placeholder:", await p.locator("textarea").first().getAttribute("placeholder"));
p = await open();
await type(p, "TESTE-A2 servidor recusa");
await p.waitForTimeout(1500);
console.log("A2 servidor recusa:", JSON.stringify(await state(p, "TESTE-A2")));
await p.screenshot({ path: `${out}/a-offline.png` });

// B: sem ack em 20 s (simulado): SSE message real -> SSE remove -> POST 500
p = await open();
const jid = p.jid;
await p.route("**/send", async (r) => { await new Promise((s) => setTimeout(s, 1500)); await r.fulfill({ status: 500, json: { error: "O WhatsApp não confirmou o recebimento em 20 s. Confira a conexão e tente de novo." } }); });
await type(p, "TESTE-B sem ack");
await p.waitForTimeout(300);
await p.evaluate((jid) => window.dispatchEvent(new CustomEvent("inbox:message", { detail: { chatJid: jid, id: "REAL1", fromMe: true, at: Date.now(), text: "TESTE-B sem ack", kind: "text", media: null, contacts: null, quoted: null, deleted: false, sender: null, ack: 0, editedAt: null, reactions: [], extra: null, poll: null, starred: false, forwarded: 0 } })), jid);
await p.waitForTimeout(600);
console.log("B meio (jid " + (jid ? "ok" : "FALTOU") + "):", JSON.stringify(await state(p, "TESTE-B")));
await p.evaluate((jid) => window.dispatchEvent(new CustomEvent("inbox:remove", { detail: { chatJid: jid, id: "REAL1" } })), jid);
await p.waitForTimeout(2500);
console.log("B fim:", JSON.stringify(await state(p, "TESTE-B")));
await p.screenshot({ path: `${out}/b-sem-ack.png` });
const real = (id, at) => ({ chatJid: jid, id, fromMe: true, at, text: "TESTE-B sem ack", kind: "text", media: null, contacts: null, quoted: null, deleted: false, sender: null, ack: 2, editedAt: null, reactions: [], extra: null, poll: null, starred: false, forwarded: 0 });
await p.evaluate((m) => window.dispatchEvent(new CustomEvent("inbox:message", { detail: m })), real("REAL1", Date.now()));
await p.waitForTimeout(400);
console.log("B2 ack atrasado:", JSON.stringify(await state(p, "TESTE-B")));
// E: horário corrigido para antes da penúltima mensagem -> sobe uma posição
const order = () => p.evaluate(() => [...document.querySelectorAll(".bubble")].slice(-2).map((x) => x.textContent.includes("TESTE-B")));
const before = await order();
const prevAt = await p.evaluate(async (jid) => { const l = await (await fetch(`/api/chats/${encodeURIComponent(jid)}/messages`)).json(); return l[l.length - 1].at; }, jid);
await p.evaluate((m) => window.dispatchEvent(new CustomEvent("inbox:update", { detail: m })), real("REAL1", prevAt - 1000));
await p.waitForTimeout(400);
console.log("E reordena com horário novo:", JSON.stringify(before), "->", JSON.stringify(await order()));
// D: bolha falhada visível, troca de conversa e volta
await p.unroute("**/send");
await p.route("**/send", (r) => r.fulfill({ status: 500, json: { error: "falha simulada" } }));
await type(p, "TESTE-D falhou e saí");
await p.waitForTimeout(800);
console.log("D antes de sair:", JSON.stringify(await state(p, "TESTE-D")));
await p.locator(".chat-item").nth(1).click();
await p.waitForTimeout(500);
await p.locator(".chat-item").first().click();
await p.waitForTimeout(1000);
console.log("D de volta:", JSON.stringify(await state(p, "TESTE-D")));

// C: falha com o usuário em outra conversa
p = await open();
await p.route("**/send", async (r) => { await new Promise((s) => setTimeout(s, 1500)); await r.fulfill({ status: 500, json: { error: "falha simulada" } }); });
await type(p, "TESTE-C troca");
await p.locator(".chat-item").nth(1).click();
await p.waitForTimeout(2500);
console.log("C na outra conversa:", JSON.stringify(await state(p, "TESTE-C")));
await p.locator(".chat-item").first().click();
await p.waitForTimeout(1000);
console.log("C de volta:", JSON.stringify(await state(p, "TESTE-C")));
await p.screenshot({ path: `${out}/c-troca.png` });
// F: SSE mostrou a real, o POST falha e o aviso de remoção nunca chega
p = await open();
await p.route("**/send", async (r) => { await new Promise((s) => setTimeout(s, 1200)); await r.fulfill({ status: 500, json: { error: "falha simulada" } }); });
await type(p, "TESTE-F sem remove");
await p.waitForTimeout(300);
await p.evaluate((jid) => window.dispatchEvent(new CustomEvent("inbox:message", { detail: { chatJid: jid, id: "REALF", fromMe: true, at: Date.now() - 60000, text: "TESTE-F sem remove", kind: "text", media: null, contacts: null, quoted: null, deleted: false, sender: null, ack: 1, editedAt: null, reactions: [], extra: null, poll: null, starred: false, forwarded: 0 } })), p.jid);
await p.waitForTimeout(2500);
console.log("F sem remove:", JSON.stringify(await state(p, "TESTE-F")));
// G: mesma coisa, mas o usuário sai antes da falha -> sem fantasma ao voltar, texto no rascunho uma vez
p = await open();
await p.route("**/send", async (r) => { await new Promise((s) => setTimeout(s, 1500)); await r.fulfill({ status: 500, json: { error: "falha simulada" } }); });
await type(p, "TESTE-G fantasma");
await p.waitForTimeout(300);
await p.evaluate((jid) => window.dispatchEvent(new CustomEvent("inbox:message", { detail: { chatJid: jid, id: "REALG", fromMe: true, at: Date.now(), text: "TESTE-G fantasma", kind: "text", media: null, contacts: null, quoted: null, deleted: false, sender: null, ack: 1, editedAt: null, reactions: [], extra: null, poll: null, starred: false, forwarded: 0 } })), p.jid);
await p.waitForTimeout(300);
await p.locator(".chat-item").nth(1).click();
await p.waitForTimeout(2500);
await p.locator(".chat-item").first().click();
await p.waitForTimeout(1000);
console.log("G de volta:", JSON.stringify(await state(p, "TESTE-G")));
await p.screenshot({ path: `${out}/g-rascunho.png` });
await b.close();
