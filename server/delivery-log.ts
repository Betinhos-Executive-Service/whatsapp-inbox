import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";

/** Uma tentativa de envio: o que foi, para quem, se o WhatsApp confirmou e quanto tempo levou. */
export type DeliveryEntry = {
  kind: string;
  jid: string;
  id?: string | null;
  ok: boolean;
  ms: number;
  error?: string;
};

/** Acima disto o arquivo vira `.1` e começa outro: o log nunca cresce sem limite. */
const ROTATE_BYTES = 1_000_000;

const stamp = (at = new Date()) =>
  at.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo", hour12: false }).replace("T", " ");

/** Linha de texto, uma por tentativa, legível sem ferramenta: data, resultado, tipo, destino, id, tempo e erro. */
export function formatEntry(e: DeliveryEntry, at = new Date()): string {
  const who = e.jid.split("@")[0];
  const cols = [stamp(at), e.ok ? "OK  " : "ERRO", e.kind.padEnd(8), who, `id=${e.id ?? "-"}`, `${(e.ms / 1000).toFixed(1).replace(".", ",")}s`];
  if (!e.ok) cols.push(e.error?.replace(/\s+/g, " ").trim() || "erro desconhecido");
  return cols.join("  ");
}

/** Log de envios em arquivo, para conferir depois o que saiu e o que o WhatsApp recusou. */
export class DeliveryLog {
  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }

  record(entry: DeliveryEntry): string {
    const line = formatEntry(entry);
    try {
      if (existsSync(this.file) && statSync(this.file).size > ROTATE_BYTES) renameSync(this.file, `${this.file}.1`);
      appendFileSync(this.file, `${line}\n`, "utf8");
    } catch (error) {
      console.error(`Não deu para gravar o log de envios: ${(error as Error).message}`);
    }
    if (!entry.ok) console.error(`Envio falhou: ${line}`);
    return line;
  }

  /** Últimas `limit` linhas, da mais recente para a mais antiga. */
  tail(limit = 200): string[] {
    if (!existsSync(this.file)) return [];
    try {
      return readFileSync(this.file, "utf8").split("\n").filter(Boolean).slice(-limit).reverse();
    } catch {
      return [];
    }
  }
}
