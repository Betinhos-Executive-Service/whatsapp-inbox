import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWa, stripWa, toggleWa } from "../ui/wa-text.ts";

test("formatação do WhatsApp: marcadores válidos", () => {
  assert.deepEqual(parseWa("oi *mundo*!"), ["oi ", { kind: "b", marker: "*", children: ["mundo"] }, "!"]);
  assert.deepEqual(parseWa("*_x_*"), [{ kind: "b", marker: "*", children: [{ kind: "i", marker: "_", children: ["x"] }] }]);
  assert.deepEqual(parseWa("~a b~"), [{ kind: "s", marker: "~", children: ["a b"] }]);
  assert.deepEqual(parseWa("```a *b*\nc```"), [{ kind: "mono", marker: "```", children: ["a *b*\nc"] }]);
  assert.deepEqual(parseWa("`x_y_`"), [{ kind: "code", marker: "`", children: ["x_y_"] }]);
});

test("formatação do WhatsApp: casos que ficam como texto", () => {
  for (const t of ["2*3*4", "* a*", "*a *", "a*b*", "*a\nb*", "nome_do_arquivo.txt", "**", "*"]) {
    assert.deepEqual(parseWa(t), [t], t);
  }
  assert.equal(stripWa("*Reserva* _confirmada_"), "Reserva confirmada");
});

test("atalho liga e desliga o marcador na seleção", () => {
  assert.deepEqual(toggleWa("ola mundo", 4, 9, "*"), { text: "ola *mundo*", start: 5, end: 10 });
  assert.deepEqual(toggleWa("ola *mundo*", 5, 10, "*"), { text: "ola mundo", start: 4, end: 9 });
  assert.deepEqual(toggleWa("ab", 1, 1, "_"), { text: "a__b", start: 2, end: 2 });
});
