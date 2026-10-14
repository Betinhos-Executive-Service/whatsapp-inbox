// server/vigilancia/job.ts
import type { Store } from "../db.ts";
import type { TokenUsage } from "../pricing.ts";
import { normalizarPlaca } from "./infleet.ts";
import { templateReserva, type Redacao } from "./mensagem.ts";
import { avaliar, deveEnviar, marcarParada } from "./regras.ts";
import type { Avaliacao, ConfigRegras, Coord, Nivel, OsVigiada, Parada, Posicao, Rota } from "./tipos.ts";

const MIN = 60_000;
const LIMPAR_APOS_MIN = 30;
const FALHAS_PARA_AVISAR = 3;
const REPETIR_AVISO_FONTE_MS = 60 * MIN;

export type ConfigVigilancia = { grupoJid: string; janelaMin: number; cadenciaMin: number; ensaio: boolean; regras: ConfigRegras };

export type DepsVigilancia = {
  dataverse: { osNaJanela(agora: number, janelaMin: number): Promise<OsVigiada[]> };
  infleet: { frota(): Promise<Map<string, Posicao>> };
  geocodificador: { localizar(endereco: string): Promise<Coord | null> };
  roteador: { rota(origem: Coord, destino: Coord): Promise<Rota | null> };
  redator: { redigir(av: Avaliacao): Promise<Redacao> };
  estado: Pick<Store, "vigilanciaNivel" | "vigilanciaRegistrar" | "vigilanciaLimpar">;
  /** Devolve o id da mensagem, ou null quando o WhatsApp não está conectado. */
  enviar: (jid: string, texto: string) => Promise<string | null>;
  registrarUso?: (usage: TokenUsage | null, ok: boolean) => void;
  log: (msg: string) => void;
  agora?: () => number;
};

export type ResultadoCiclo = {
  em: number;
  avaliadas: { osId: string; os: string; nivel: Nivel; anterior: Nivel | null; folgaMin: number | null }[];
  enviadas: { osId: string; nivel: Nivel; texto: string; reserva: boolean }[];
  erros: string[];
  ensaio: boolean;
};

type Fonte = "Dataverse" | "Infleet" | "rota";

export class Vigilancia {
  private timer: NodeJS.Timeout | null = null;
  private rodando: Promise<ResultadoCiclo> | null = null;
  private ultimoResultado: ResultadoCiclo | null = null;
  private readonly paradas = new Map<string, Parada>();
  private readonly falhas = new Map<Fonte, number>();
  private readonly avisadoAt = new Map<Fonte, number>();
  private readonly agora: () => number;
  private readonly deps: DepsVigilancia;
  private readonly config: ConfigVigilancia;

  constructor(deps: DepsVigilancia, config: ConfigVigilancia) {
    this.deps = deps;
    this.config = config;
    this.agora = deps.agora ?? Date.now;
  }

  ultimo(): ResultadoCiclo | null {
    return this.ultimoResultado;
  }

  emExecucao(): boolean {
    return this.timer !== null;
  }

  iniciar(): void {
    if (this.timer) return;
    const tick = () => void this.ciclo().catch((e: Error) => this.deps.log(`Vigilância: ciclo falhou: ${e.message}`));
    this.timer = setInterval(tick, this.config.cadenciaMin * MIN);
    this.timer.unref();
    tick();
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Um ciclo por vez: chamada concorrente recebe o ciclo em andamento. */
  ciclo(): Promise<ResultadoCiclo> {
    if (this.rodando) return this.rodando;
    this.rodando = this.executar().finally(() => (this.rodando = null));
    return this.rodando;
  }

  private async executar(): Promise<ResultadoCiclo> {
    const agora = this.agora();
    const r: ResultadoCiclo = { em: agora, avaliadas: [], enviadas: [], erros: [], ensaio: this.config.ensaio };
    this.deps.estado.vigilanciaLimpar(agora - LIMPAR_APOS_MIN * MIN);

    const lista = await this.fonte("Dataverse", () => this.deps.dataverse.osNaJanela(agora, this.config.janelaMin), r);
    const frota = await this.fonte("Infleet", () => this.deps.infleet.frota(), r);
    if (!lista || !frota) return this.concluir(r);

    let rotaFalhou = false, rotaPedida = false;
    for (const os of lista) {
      const posicao = os.placa ? (frota.get(normalizarPlaca(os.placa)) ?? null) : null;
      const parada = posicao ? marcarParada(this.paradas.get(normalizarPlaca(os.placa!)), posicao) : null;
      if (posicao && parada) this.paradas.set(normalizarPlaca(os.placa!), parada);
      let embarque: Coord | null = null;
      if (os.endereco) {
        try {
          embarque = await this.deps.geocodificador.localizar(os.endereco);
        } catch (e) {
          r.erros.push(`Geocodificação de "${os.endereco}": ${(e as Error).message}`);
        }
      }
      let rota: Rota | null = null;
      if (posicao && embarque && os.saidaAt - agora <= this.config.regras.rotaAteMin * MIN) {
        rotaPedida = true;
        rota = await this.deps.roteador.rota(posicao, embarque);
        if (!rota) rotaFalhou = true;
      }
      const av = avaliar({ os, posicao, rota, embarque, parada, agora, cfg: this.config.regras });
      const anterior = this.deps.estado.vigilanciaNivel(os.id);
      r.avaliadas.push({ osId: os.id, os: av.fatos.os, nivel: av.nivel, anterior, folgaMin: av.fatos.folgaMin });
      if (deveEnviar(anterior, av.nivel)) await this.avisar(av, os, r);
    }
    if (rotaPedida) this.contarFonte("rota", rotaFalhou, r);
    return this.concluir(r);
  }

  private async avisar(av: Avaliacao, os: OsVigiada, r: ResultadoCiclo): Promise<void> {
    if (this.config.ensaio) {
      r.enviadas.push({ osId: os.id, nivel: av.nivel, texto: templateReserva(av), reserva: true });
      return;
    }
    const red = await this.deps.redator.redigir(av);
    this.deps.registrarUso?.(red.usage, !red.reserva);
    if (red.erro) this.deps.log(`Vigilância: redação pela API falhou (${red.erro}); usando o template.`);
    const id = await this.deps.enviar(this.config.grupoJid, red.texto);
    if (id === null) {
      r.erros.push(`WhatsApp desconectado: aviso da ${av.fatos.os} fica para o próximo ciclo.`);
      return;
    }
    this.deps.estado.vigilanciaRegistrar(os.id, av.nivel, os.saidaAt, this.agora());
    r.enviadas.push({ osId: os.id, nivel: av.nivel, texto: red.texto, reserva: red.reserva });
  }

  private async fonte<T>(nome: Fonte, buscar: () => Promise<T>, r: ResultadoCiclo): Promise<T | null> {
    try {
      const v = await buscar();
      await this.contarFonte(nome, false, r);
      return v;
    } catch (e) {
      r.erros.push(`${nome}: ${(e as Error).message}`);
      await this.contarFonte(nome, true, r);
      return null;
    }
  }

  /** 3 falhas seguidas → aviso no grupo (1 por hora); ao voltar, avisa que normalizou. */
  private async contarFonte(nome: Fonte, falhou: boolean, r: ResultadoCiclo): Promise<void> {
    const n = falhou ? (this.falhas.get(nome) ?? 0) + 1 : 0;
    this.falhas.set(nome, n);
    const avisadoAt = this.avisadoAt.get(nome);
    if (falhou && n >= FALHAS_PARA_AVISAR && (avisadoAt === undefined || this.agora() - avisadoAt >= REPETIR_AVISO_FONTE_MS)) {
      if (await this.enviarServico(`*⚠️ Vigilância sem dados: ${nome}*\n• ${n} ciclos seguidos sem resposta. Os avisos de atraso podem não sair até normalizar.`, r)) this.avisadoAt.set(nome, this.agora());
    } else if (!falhou && avisadoAt !== undefined) {
      if (await this.enviarServico(`*✅ Vigilância normalizada: ${nome}*\n• Voltou a responder; os avisos seguem normalmente.`, r)) this.avisadoAt.delete(nome);
    }
  }

  private async enviarServico(texto: string, r: ResultadoCiclo): Promise<boolean> {
    if (this.config.ensaio) {
      r.enviadas.push({ osId: "", nivel: "ok", texto, reserva: true });
      return true;
    }
    return (await this.deps.enviar(this.config.grupoJid, texto)) !== null;
  }

  private concluir(r: ResultadoCiclo): ResultadoCiclo {
    for (const e of r.erros) this.deps.log(`Vigilância: ${e}`);
    this.ultimoResultado = r;
    return r;
  }
}
