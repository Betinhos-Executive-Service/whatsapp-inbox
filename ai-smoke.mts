import { LocalAI } from "./server/ai.ts";
const ai = new LocalAI(process.env.TEMP + "/wi-models", (s) => { if (s.state !== "baixando" || s.percent % 20 === 0) console.log("status", JSON.stringify(s)); });
await ai.download();
const now = Date.now();
const msgs = [
  { chatJid: "x", id: "1", fromMe: false, at: now - 7200e3, text: "Bom dia! Preciso de um carro amanhã às 7h, saindo da Vila Olímpia para Guarulhos.", kind: "text", media: null },
  { chatJid: "x", id: "2", fromMe: true, at: now - 7000e3, text: "Bom dia, Ana! Consigo sim. Para quantas pessoas?", kind: "text", media: null },
  { chatJid: "x", id: "3", fromMe: false, at: now - 600e3, text: "Somos 3, com 4 malas grandes. Qual o valor?", kind: "text", media: null },
];
let t = performance.now();
console.log("RASCUNHO:", await ai.draft("Ana", msgs as any, ""), `(${Math.round(performance.now() - t)} ms, inclui carregar)`);
t = performance.now();
console.log("RESUMO:", JSON.stringify(await ai.summarize("Ana", msgs as any)), `(${Math.round(performance.now() - t)} ms)`);
await ai.close();
