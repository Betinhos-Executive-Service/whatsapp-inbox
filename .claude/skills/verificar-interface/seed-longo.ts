// Histórico longo na Mariana (250 mensagens, "bagagem" em 3 delas, longe entre si) para testar
// "mostrar na conversa" com mensagem fora do que está carregado. Rode depois do seed.ts.
// Uso: node .claude/skills/verificar-interface/seed-longo.ts data
import { join, resolve } from "node:path";
import { Store } from "../../../server/db.ts";

const s = new Store(join(resolve(process.argv[2] ?? "data"), "inbox.db"));
const jid = "5511990000001@s.whatsapp.net";
const now = Date.now();
for (let i = 0; i < 250; i++) {
  const text = i === 20 || i === 120 || i === 230 ? `Lembrar da bagagem extra do Sr. Roberto (${i})` : `Mensagem antiga número ${i}`;
  s.addMessage({ chatJid: jid, rawJid: jid, participant: null, id: `longo${i}`, fromMe: i % 3 === 0, at: now - (50 + 250 - i) * 3_600_000, text, kind: "text" }, false);
}
