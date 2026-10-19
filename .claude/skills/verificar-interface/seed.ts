// Semeia <pasta>/inbox.db com conversas fictícias para verificar a interface sem WhatsApp.
// Uso (na raiz do projeto): node .claude/skills/verificar-interface/seed.ts data
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store, type IncomingMessage } from "../../../server/db.ts";

const dataDir = resolve(process.argv[2] ?? "data");
mkdirSync(dataDir, { recursive: true });
const s = new Store(join(dataDir, "inbox.db"));
const now = Date.now();
const min = 60_000;
let n = 0;
const m = (chatJid: string, text: string, ago: number, fromMe = false, participant?: string): IncomingMessage => ({
  chatJid, rawJid: chatJid, participant: participant ?? null, id: `seed${++n}`, fromMe, at: now - ago * min, text, kind: "text",
});

type C = { jid: string; name: string; msgs: [string, number, boolean?, string?][]; label?: string; prio?: "alta" | "media" | "baixa"; status?: "aberta" | "aguardando" | "resolvida"; pinned?: boolean };
const chats: C[] = [
  { jid: "5511990000001@s.whatsapp.net", name: "Mariana Alves (Secretária Dir. Itaú)", label: "Reserva", prio: "media", msgs: [
    ["Bom dia! Preciso de um carro executivo para o Sr. Roberto amanhã às 07:30, saindo do Jardins para Guarulhos, Terminal 3.", 42],
    ["Voo LA3420 às 10h. Ele vai com 2 malas.", 41],
    ["Consegue confirmar até às 16h?", 12],
  ] },
  { jid: "5511990000002@s.whatsapp.net", name: "Carlos Mendes", label: "Cotação", prio: "media", msgs: [
    ["Olá, quanto fica um transfer de Congonhas para Alphaville sexta às 18h? Somos 3 pessoas.", 95],
  ] },
  { jid: "5511990000003@s.whatsapp.net", name: "João Pereira (Motorista)", label: "Operação", prio: "alta", pinned: true, msgs: [
    ["Cheguei no hotel, passageiro ainda não desceu", 8],
    ["Recepção diz que ele saiu pelos fundos?? Não estou achando", 3],
  ] },
  { jid: "5511990000004@s.whatsapp.net", name: "Financeiro Grupo Vale", label: "Financeiro", prio: "baixa", status: "aguardando", msgs: [
    ["Segue comprovante do pagamento da fatura 0921.", 300],
    ["Recebido, obrigado! Vamos dar baixa ainda hoje.", 290, true],
  ] },
  { jid: "5511990000005@s.whatsapp.net", name: "Fernanda Lima", label: "Pessoal", prio: "baixa", status: "resolvida", msgs: [
    ["Feliz aniversário!! 🎉", 2000],
    ["Obrigado, Fer! 😊", 1990, true],
  ] },
  { jid: "5511990000006@s.whatsapp.net", name: "", msgs: [
    ["Oi, peguei o contato de vocês com a Bianca. Vocês fazem casamento? Precisaria de 2 carros para dia 14/11 em Campos do Jordão.", 25],
  ] },
  { jid: "120363000000000001@g.us", name: "Operação Betinhos — Escala", label: "Operação", prio: "alta", msgs: [
    ["Escala de amanhã publicada no sistema", 180, false, "5511990000010@s.whatsapp.net"],
    ["OS 4471 está sem motorista ainda", 30, false, "5511990000011@s.whatsapp.net"],
    ["Vou ver com o Paulo", 20, true],
  ] },
];
for (const c of chats) {
  for (const [text, ago, fromMe, participant] of c.msgs) s.addMessage(m(c.jid, text, ago, fromMe, participant), true);
  if (c.name) s.setNames(c.jid, { saved: c.name });
  if (c.label) s.saveClassification(c.jid, { label: c.label, confidence: 0.9, needsReply: c.status ? 0 : 1, urgent: c.prio === "alta" ? 1 : 0, priority: c.prio, reason: "Dado de teste." });
  if (c.status) s.updateChat(c.jid, { status: c.status });
  if (c.pinned) s.updateChat(c.jid, { pinned: true });
}
// Volume: 60 conversas resolvidas para testar rolagem.
for (let i = 0; i < 60; i++) {
  const jid = `55119910${String(i).padStart(5, "0")}@s.whatsapp.net`;
  s.addMessage(m(jid, `Obrigado pelo atendimento de ontem (${i + 1})`, 3000 + i * 60), false);
  s.setNames(jid, { saved: `Cliente ${i + 1}` });
}
console.log(`Banco de teste em ${join(dataDir, "inbox.db")}`);
