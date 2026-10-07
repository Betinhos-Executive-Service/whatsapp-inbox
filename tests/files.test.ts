import assert from "node:assert/strict";
import { test } from "node:test";
import { fileNameFromDisposition, safeFileName } from "../desktop/files.ts";
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
