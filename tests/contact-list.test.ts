import assert from "node:assert/strict";
import { test } from "node:test";
import { contactSections, splitName } from "../ui/contact-list.ts";

const c = (name: string, phone = "5511999990000") => ({ jid: `${phone}@s.whatsapp.net`, name, phone });

test("splitName: primeira palavra é o nome", () => {
  assert.deepEqual(splitName("Ana Maria Silva"), { firstName: "Ana", lastName: "Maria Silva" });
  assert.deepEqual(splitName("  Ana  "), { firstName: "Ana", lastName: "" });
  assert.deepEqual(splitName(""), { firstName: "", lastName: "" });
});

test("contactSections: agrupa por letra sem acento e joga o resto em #", () => {
  const out = contactSections([c("Ábia"), c("Ana"), c("Bia"), c("123 Táxi")], "");
  assert.deepEqual(out.map((s) => [s.letter, s.contacts.length]), [["#", 1], ["A", 2], ["B", 1]]);
});

test("contactSections: busca por nome sem acento e por dígitos", () => {
  const list = [c("Ábia", "5511911110000"), c("Bia", "5521922220000")];
  assert.deepEqual(contactSections(list, "abi")[0].contacts.map((x) => x.name), ["Ábia"]);
  assert.deepEqual(contactSections(list, "(21) 9222")[0].contacts.map((x) => x.name), ["Bia"]);
  assert.deepEqual(contactSections(list, "zzz"), []);
});
