import assert from "node:assert/strict";
import { test } from "node:test";
import { firstLink, parseWa, splitLinks } from "../ui/wa-text.ts";
import { isPrivateAddress, parsePreview } from "../server/link-preview.ts";
import { selectionText } from "../ui/selection-text.ts";

test("links: detecta http, https e www, sem pontuação final", () => {
  assert.deepEqual(splitLinks("veja https://a.com/x_y_z."), ["veja ", { url: "https://a.com/x_y_z", href: "https://a.com/x_y_z" }, "."]);
  assert.deepEqual(splitLinks("(www.betinhos.com.br)"), ["(", { url: "www.betinhos.com.br", href: "https://www.betinhos.com.br" }, ")"]);
  assert.equal(firstLink("https://pt.wikipedia.org/wiki/A_(b) ok"), "https://pt.wikipedia.org/wiki/A_(b)");
  assert.equal(firstLink("sem link aqui, http://x"), null);
});

test("links: _ e * dentro do link não viram formatação", () => {
  assert.deepEqual(parseWa("https://a.com/_x_ e _y_"), ["https://a.com/_x_ e ", { kind: "i", marker: "_", children: ["y"] }]);
});

test("prévia: lê Open Graph com fallback para <title>", () => {
  const html = `<head><meta property="og:title" content="Betinhos &amp; Cia"><meta name="description" content='Transporte'><meta property="og:image" content="/img.png"></head>`;
  assert.deepEqual(parsePreview(html, new URL("https://www.exemplo.com/a")), {
    url: "https://www.exemplo.com/a", title: "Betinhos & Cia", description: "Transporte", image: "https://www.exemplo.com/img.png", site: "exemplo.com",
  });
  assert.equal(parsePreview("<title>Só título</title>", new URL("https://x.com"))?.title, "Só título");
  assert.equal(parsePreview("<p>nada</p>", new URL("https://x.com")), null);
});

test("prévia: não busca endereços locais", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  assert.ok(!isPrivateAddress("8.8.8.8"));
});

test("seleção: copia no formato do WhatsApp", () => {
  const at = new Date(2026, 9, 8, 9, 5).getTime();
  const m = (id: string, text: string) => ({ id, at, text }) as never;
  const describe = (x: { text: string }) => ({ author: "Ana", text: x.text });
  assert.equal(selectionText([m("1", "oi")], describe), "oi");
  assert.equal(selectionText([m("1", "oi"), m("2", "tudo?")], describe), "[09:05, 08/10/2026] Ana: oi\n[09:05, 08/10/2026] Ana: tudo?");
});
