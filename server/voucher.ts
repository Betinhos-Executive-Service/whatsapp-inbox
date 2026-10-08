// PDF do voucher de confirmação com o template da Tela Voucher (pasta voucher/, copiada para dist/voucher).
// O template busca as OS pelo `Xrm` do Dynamics; aqui um `Xrm` falso entrega os dados que o Claude leu do
// Dataverse, e o Edge (ou Chrome) em modo headless imprime em A4. Nada é gravado no Dataverse.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const when = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), "Data e hora inválidas (use ISO 8601 com fuso, ex.: 2026-10-09T08:30:00-03:00).");

/** Dados do voucher, como o Claude lê das OS no Dataverse. Cabeçalho = dados da primeira OS. */
export const voucherSchema = z.object({
  servicos: z
    .array(
      z.object({
        os: z.string().trim().min(1).max(40).describe("Número da OS (cr40f_id), ex.: OS-1896."),
        dataHoraSaida: when.describe("cr40f_dataehorriodesada em ISO 8601 com fuso, ex.: 2026-10-09T08:30:00-03:00."),
        trajeto: z.string().max(500).default("").describe("cr40f_trajeto."),
      }),
    )
    .min(1)
    .max(20)
    .describe("Uma linha por OS (ida e volta ou vários dias no mesmo voucher)."),
  passageiros: z.array(z.string().trim().min(1).max(200)).max(20).default([]).describe("Nomes de cr40f_servicosporpassageiro da primeira OS, na ordem de embarque."),
  empresa: z.string().max(200).default("").describe("Cliente (_cr40f_cliente_value, valor formatado)."),
  solicitante: z.string().max(200).default("").describe("_cr40f_solicitante_value, valor formatado."),
  email: z.string().max(200).default("").describe("cr40f_email."),
  telefone: z.string().max(500).default("").describe("cr40f_passageirosetelefonedecontato."),
  observacoes: z.string().max(2000).default("").describe("cr40f_obsdeoperao (sai impresso para o cliente)."),
  categoriaVeiculo: z.string().max(200).default("").describe("cr40f_tipodeveiculo, valor formatado."),
});
export type Voucher = z.infer<typeof voucherSchema>;

export type VoucherAssets = { html: string; css: string; js: string; logo: Buffer };

const FILES = { html: "cr40f_VoucherConfirmacao.html", css: "cr40f_VoucherConfirmacao.css", js: "cr40f_VoucherConfirmacao.js", logo: "cr40f_VoucherConfirmacaoLogo.png" };

export async function readVoucherAssets(dir: string): Promise<VoucherAssets> {
  const [html, css, js, logo] = await Promise.all([readFile(join(dir, FILES.html), "utf8"), readFile(join(dir, FILES.css), "utf8"), readFile(join(dir, FILES.js), "utf8"), readFile(join(dir, FILES.logo))]);
  return { html, css, js, logo };
}

const F = "@OData.Community.Display.V1.FormattedValue";
/** GUID fictício no formato que o template aceita (`/^[0-9a-f-]{36}$/`). */
const fakeId = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
/** JSON dentro de <script>: `</script>` no texto não pode fechar a tag. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
/** Tela de edição, avisos e versão da tela não vão para o papel. */
const PRINT_ONLY_SHEETS = ".app-toolbar,.settings-panel,.version-label,#loadingState,#errorState{display:none!important}";

/** Substitui exatamente uma vez; se o template mudou e o trecho sumiu, falha em vez de gerar PDF errado. */
function replaceOnce(text: string, pattern: RegExp, value: string): string {
  let hits = 0;
  // Função como substituto: `$` no CSS ou no JS não vira padrão de troca.
  const out = text.replace(pattern, () => {
    hits++;
    return value;
  });
  if (hits === 0) throw new Error(`Template do voucher mudou: não achei ${pattern}.`);
  return out;
}

/** HTML autocontido (CSS, JS e logo embutidos) e os ids que o template lê de `?ids=`. */
export function voucherHtml(assets: VoucherAssets, voucher: Voucher): { html: string; ids: string[] } {
  // O template tira o cabeçalho e os passageiros da primeira OS: a mais antiga primeiro.
  const services = [...voucher.servicos].sort((a, b) => Date.parse(a.dataHoraSaida) - Date.parse(b.dataHoraSaida));
  const ids = services.map((_, i) => fakeId(i));
  const records = Object.fromEntries(
    services.map((s, i) => [
      ids[i],
      {
        cr40f_reservadeveculosid: ids[i],
        cr40f_id: s.os,
        cr40f_dataehorriodesada: s.dataHoraSaida,
        cr40f_trajeto: s.trajeto,
        cr40f_obsdeoperao: voucher.observacoes,
        cr40f_email: voucher.email,
        cr40f_passageirosetelefonedecontato: voucher.telefone,
        [`cr40f_tipodeveiculo${F}`]: voucher.categoriaVeiculo,
        [`_cr40f_cliente_value${F}`]: voucher.empresa,
        [`_cr40f_solicitante_value${F}`]: voucher.solicitante,
      },
    ]),
  );
  const links = voucher.passageiros.map((name) => ({ [`_cr40f_bancodedados_value${F}`]: name }));
  const stub = `(function(){var R=${scriptJson(records)},L=${scriptJson(links)};window.Xrm={WebApi:{retrieveRecord:function(t,id){return Promise.resolve(R[id]);},retrieveMultipleRecords:function(){return Promise.resolve({entities:L});}},Utility:{getGlobalContext:function(){return{userSettings:{userId:"whatsapp-inbox"}};}}};})();`;
  let html = assets.html;
  html = replaceOnce(html, /<link rel="stylesheet" href="\.\/cr40f_VoucherConfirmacao\.css[^"]*">/, `<style>${assets.css}</style><style media="print">${PRINT_ONLY_SHEETS}</style>`);
  // html2canvas e jsPDF só servem ao botão Baixar PDF da tela; aqui quem gera é o navegador.
  html = html.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/[^"]*"><\/script>\s*/g, "");
  html = replaceOnce(html, /<script src="\.\/cr40f_VoucherConfirmacao\.js[^"]*"><\/script>/, `<script>${stub}</script><script>${assets.js}</script>`);
  html = replaceOnce(html, /\.\/cr40f_VoucherConfirmacaoLogo\.png/g, `data:image/png;base64,${assets.logo.toString("base64")}`);
  return { html, ids };
}

/** Nome do anexo no WhatsApp: "Voucher OS-1896 + OS-1897.pdf". */
export function voucherFileName(voucher: Voucher): string {
  const os = voucher.servicos.map((s) => s.os.replace(/[\\/:*?"<>|]+/g, "-"));
  return `Voucher ${os.join(" + ")}.pdf`;
}

/** Edge (vem com o Windows) ou Chrome. VOUCHER_BROWSER força um caminho. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.VOUCHER_BROWSER) return existsSync(env.VOUCHER_BROWSER) ? env.VOUCHER_BROWSER : null;
  const roots = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => !!r);
  const apps = [join("Microsoft", "Edge", "Application", "msedge.exe"), join("Google", "Chrome", "Application", "chrome.exe")];
  for (const app of apps) for (const root of roots) if (existsSync(join(root, app))) return join(root, app);
  return null;
}

const RENDER_TIMEOUT_MS = 60_000;

export type PdfRun = (bin: string, args: string[]) => Promise<void>;

const runBrowser: PdfRun = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("O navegador demorou demais para gerar o PDF do voucher."));
    }, RENDER_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível abrir o navegador para gerar o PDF (${e.message}).`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Imprime o voucher em PDF num perfil temporário (não mexe no navegador aberto da pessoa). */
export async function renderVoucherPdf(assetsDir: string, voucher: Voucher, browser: string | null = findBrowser(), run: PdfRun = runBrowser): Promise<{ body: Buffer; fileName: string }> {
  if (!browser) throw new Error("Edge ou Chrome não encontrado neste PC para gerar o PDF do voucher.");
  const { html, ids } = voucherHtml(await readVoucherAssets(assetsDir), voucher);
  const dir = await mkdtemp(join(tmpdir(), "inbox-voucher-"));
  try {
    const page = join(dir, "voucher.html");
    const out = join(dir, "voucher.pdf");
    await writeFile(page, html, "utf8");
    const url = `${pathToFileURL(page).href}?ids=${encodeURIComponent(JSON.stringify(ids))}`;
    await run(browser, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=${join(dir, "perfil")}`,
      "--no-pdf-header-footer",
      // Dá tempo de carregar a fonte e o template montar a página (Promise + requestAnimationFrame).
      "--virtual-time-budget=15000",
      `--print-to-pdf=${out}`,
      url,
    ]);
    const body = await readFile(out).catch(() => null);
    if (!body?.length) throw new Error("O navegador não gerou o PDF do voucher.");
    return { body, fileName: voucherFileName(voucher) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
