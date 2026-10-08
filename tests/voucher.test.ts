import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { readVoucherAssets, renderVoucherPdf, voucherFileName, voucherHtml, voucherSchema } from "../server/voucher.ts";

const dir = join(import.meta.dirname, "..", "voucher");
const voucher = voucherSchema.parse({
  servicos: [
    { os: "OS-2", dataHoraSaida: "2026-10-10T18:00:00-03:00", trajeto: "GRU / Hotel" },
    { os: "OS-1", dataHoraSaida: "2026-10-09T08:30:00-03:00", trajeto: "Hotel / GRU" },
  ],
  passageiros: ["Ana </script><b>x</b>"],
  empresa: "ACME $& Cia",
});

test("voucher: HTML autocontido, sem CDN, com o Xrm falso e a OS mais antiga primeiro", async () => {
  const { html, ids } = voucherHtml(await readVoucherAssets(dir), voucher);
  assert.equal(ids.length, 2);
  assert.match(ids[0], /^[0-9a-f-]{36}$/);
  assert.ok(!html.includes("cdnjs.cloudflare.com"));
  assert.ok(!html.includes("./cr40f_VoucherConfirmacao"));
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(html.indexOf("window.Xrm=") < html.indexOf("function loadData"));
  // `</script>` no dado não fecha a tag; `$&` não vira padrão de substituição.
  assert.ok(!html.includes("Ana </script>"));
  assert.ok(html.includes("ACME $& Cia"));
  assert.ok(html.indexOf('"OS-1"') < html.indexOf('"OS-2"'));
});

test("voucher: template alterado falha em vez de gerar PDF errado", async () => {
  const assets = await readVoucherAssets(dir);
  assert.throws(() => voucherHtml({ ...assets, html: "<html></html>" }, voucher), /Template do voucher mudou/);
});

test("voucher: nome do arquivo e erro sem navegador", async () => {
  assert.equal(voucherFileName(voucher), "Voucher OS-2 + OS-1.pdf");
  await assert.rejects(renderVoucherPdf(dir, voucher, null), /Edge ou Chrome não encontrado/);
});

test("voucher: chama o navegador em perfil temporário e lê o PDF gerado", async () => {
  let args: string[] = [];
  const { writeFile } = await import("node:fs/promises");
  const pdf = await renderVoucherPdf(dir, voucher, "edge.exe", async (_bin, a) => {
    args = a;
    const out = a.find((x) => x.startsWith("--print-to-pdf="))!.slice("--print-to-pdf=".length);
    await writeFile(out, "%PDF-1.4 teste");
  });
  assert.equal(pdf.body.toString(), "%PDF-1.4 teste");
  assert.ok(args.some((a) => a.startsWith("--user-data-dir=")));
  assert.match(args.at(-1)!, /^file:.*voucher\.html\?ids=%5B/);
});
