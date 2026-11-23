import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { requestLine } from "../desktop/clipboard-files.ts";
import { bundleNames, bundlePaths, fileNameFromDisposition, mediaToTemp, safeFileName } from "../desktop/files.ts";
import { servedType } from "../server/http.ts";

test("nome de arquivo seguro no Windows", () => {
  assert.equal(safeFileName("JULIAN LOPEZ.pdf"), "JULIAN LOPEZ.pdf");
  assert.equal(safeFileName('a<b>:c"d/e\\f|g?h*.pdf'), "a_b__c_d_e_f_g_h_.pdf");
  assert.equal(safeFileName("relatório. "), "relatório");
  assert.equal(safeFileName("CON.txt"), "arquivo_CON.txt");
  assert.equal(safeFileName(""), "arquivo");
});

test("nome vindo do content-disposition", () => {
  assert.equal(fileNameFromDisposition("attachment; filename*=UTF-8''Recibo%20n%C2%BA%201.pdf"), "Recibo nº 1.pdf");
  assert.equal(fileNameFromDisposition('attachment; filename="backup.db"'), "backup.db");
  assert.equal(fileNameFromDisposition(null), null);
});

test("documento sem tipo ganha o tipo pela extensão para abrir na visualização", () => {
  assert.equal(servedType("application/octet-stream", "fatura.PDF"), "application/pdf");
  assert.equal(servedType("application/pdf", "x.bin"), "application/pdf");
  assert.equal(servedType("application/octet-stream", "pagina.html"), "application/octet-stream");
  assert.equal(servedType("", null), "application/octet-stream");
});

test("vários arquivos: nomes repetidos ganham sufixo, sem diferenciar maiúsculas", () => {
  assert.deepEqual(bundleNames(["imagem.jpg", "Imagem.jpg", "nota.pdf", "imagem.jpg", "sem-extensao", "sem-extensao"]), ["imagem.jpg", "Imagem (2).jpg", "nota.pdf", "imagem (3).jpg", "sem-extensao", "sem-extensao (2)"]);
});

test("vários arquivos: quem repete o nome vira cópia renomeada na própria pasta", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inbox-bundle-"));
  try {
    const a = join(dir, "a", "imagem.jpg");
    const b = join(dir, "b", "imagem.jpg");
    for (const [path, body] of [[a, "A"], [b, "B"]] as const) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    }
    const paths = await bundlePaths([a, b, a]);
    assert.deepEqual(paths, [a, join(dir, "b", "imagem (2).jpg")]);
    assert.equal(await readFile(paths[1]!, "utf8"), "B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mídia para arquivo: a segunda cópia não baixa de novo; arquivo apagado volta a baixar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inbox-media-"));
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.writeHead(200, { "content-disposition": "attachment; filename*=UTF-8''relat%C3%B3rio.pdf" });
    res.end("pdf");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [one, two] = await Promise.all([mediaToTemp(origin, "c@s.whatsapp.net", "M1", dir), mediaToTemp(origin, "c@s.whatsapp.net", "M1", dir)]);
    assert.equal(one, two);
    assert.equal(basename(one), "relatório.pdf");
    assert.equal(await mediaToTemp(origin, "c@s.whatsapp.net", "M1", dir), one);
    assert.equal(hits, 1);
    await rm(one);
    assert.equal(await readFile(await mediaToTemp(origin, "c@s.whatsapp.net", "M1", dir), "utf8"), "pdf");
    assert.equal(hits, 2);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pedido de cópia: uma linha só com ASCII, acentos escapados", () => {
  const line = requestLine(["C:\Temp\relatório ação.pdf"], "olá\n“mundo”");
  assert.match(line, /^[\x20-\x7e]+$/);
  assert.deepEqual(JSON.parse(line), { paths: ["C:\Temp\relatório ação.pdf"], text: "olá\n“mundo”" });
});
