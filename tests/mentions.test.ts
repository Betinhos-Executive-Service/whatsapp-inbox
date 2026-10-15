import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMentions, insertMention, MENTION_ALL, mentionPattern, mentionQuery } from "../ui/mentions.ts";

test("menção: detecta @ antes do cursor, insere o nome e troca pelo número ao enviar", () => {
  assert.equal(mentionQuery("Oi @an", 6), "an");
  assert.equal(mentionQuery("@", 1), "");
  assert.equal(mentionQuery("email@empresa", 13), null, "@ no meio da palavra não é menção");
  assert.equal(mentionQuery("Oi @ana tudo", 12), null, "depois do espaço já saiu da menção");

  const typed = "Oi @an, tudo bem?";
  const inserted = insertMention(typed, 6, "Ana Paula");
  assert.equal(inserted.text, "Oi @Ana Paula, tudo bem?");
  assert.equal(inserted.caret, "Oi @Ana Paula".length);
  assert.deepEqual(insertMention("@j", 2, "João"), { text: "@João ", caret: 6 });

  const sent = applyMentions("@Ana Paula e @Ana, confirmam?", [
    { label: "Ana", jid: "5511111111111@s.whatsapp.net" },
    { label: "Ana Paula", jid: "222@lid" },
  ]);
  assert.equal(sent.text, "@222 e @5511111111111, confirmam?");
  assert.deepEqual(sent.mentions, ["222@lid", "5511111111111@s.whatsapp.net"]);
  assert.equal(sent.mentionAll, false);
  assert.deepEqual(applyMentions("sem menção", [{ label: "Ana", jid: "1@lid" }]), { text: "sem menção", mentions: [], mentionAll: false });
  assert.deepEqual(applyMentions("@todos reunião às 9h", [{ label: "todos", jid: MENTION_ALL }]), { text: "@todos reunião às 9h", mentions: [], mentionAll: true });
});

test("menção: destaca o nome inteiro quando tem espaço", () => {
  const found = (text: string, names: string[] = []) => [...text.matchAll(mentionPattern(names))].map((m) => m[2]);
  assert.deepEqual(found("@Financeiro Betinhos teste", ["Financeiro Betinhos"]), ["@Financeiro Betinhos"]);
  assert.deepEqual(found("@Ana Paula e @Ana", ["Ana", "Ana Paula"]), ["@Ana Paula", "@Ana"]);
  assert.deepEqual(found("@Ana Paulada", ["Ana Paula"]), ["@Ana"], "nome conhecido só vale até o fim da palavra");
  assert.deepEqual(found("oi @5511999990000 e @joao.silva"), ["@5511999990000", "@joao.silva"]);
  assert.deepEqual(found("email@empresa.com"), [], "@ no meio da palavra não é menção");
});
