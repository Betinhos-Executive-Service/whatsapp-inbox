import type { Avaliacao, EntradaAvaliacao, Fatos, Nivel, Parada, Posicao } from "./tipos.ts";

const MIN = 60_000;
const R_TERRA_KM = 6371;

/** Distância em linha reta (haversine), em km. */
export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRA_KM * Math.asin(Math.sqrt(h));
}

/** Atualiza desde quando o carro está parado: reinicia se andou mais de 50 m, tem velocidade ou ignição ligada. */
export function marcarParada(anterior: Parada | undefined, atual: Posicao): Parada {
  const andando = atual.velocidadeKmh > 0 || atual.ignicao;
  const moveu = anterior ? distanciaKm(anterior, atual) > 0.05 : true;
  if (!anterior || andando || moveu) return { lat: atual.lat, lon: atual.lon, desdeAt: atual.fixAt };
  return anterior;
}

/** Só avisa quando o nível muda; `ok` sem alerta anterior e `atencao` logo depois de `atraso` não avisam. */
export function deveEnviar(anterior: Nivel | null, atual: Nivel): boolean {
  if (anterior === atual) return false;
  if (atual === "ok" && anterior === null) return false;
  if (atual === "atencao" && anterior === "atraso") return false;
  return true;
}

export function avaliar({ os, posicao, rota, embarque, parada, agora, cfg }: EntradaAvaliacao): Avaliacao {
  const faltamMin = Math.round((os.saidaAt - agora) / MIN);
  const distanciaKmAtual = posicao && embarque ? Math.round(distanciaKm(posicao, embarque) * 10) / 10 : null;
  const chegadaAt = rota ? agora + rota.minutos * MIN : null;
  const folgaMin = chegadaAt === null ? null : Math.round((os.saidaAt - chegadaAt) / MIN);
  const paradoHaMin = posicao && parada && posicao.velocidadeKmh === 0 && !posicao.ignicao ? Math.round((agora - parada.desdeAt) / MIN) : null;
  const fatos: Fatos = {
    os: os.numero ?? os.id,
    cliente: os.cliente,
    passageiros: os.passageiros,
    motorista: os.motorista,
    placa: os.placa,
    embarque: os.endereco,
    saidaAt: os.saidaAt,
    faltamMin,
    posicao: posicao ? { endereco: posicao.endereco, minutosSemAtualizar: Math.round((agora - posicao.fixAt) / MIN), velocidadeKmh: posicao.velocidadeKmh } : null,
    distanciaKm: distanciaKmAtual,
    trajetoMin: rota?.minutos ?? null,
    chegadaAt,
    folgaMin,
    semTransito: rota?.semTransito ?? false,
    paradoHaMin,
  };
  return { osId: os.id, nivel: nivel(fatos, cfg), fatos };
}

function nivel(f: Fatos, cfg: EntradaAvaliacao["cfg"]): Nivel {
  if (!f.motorista || !f.placa) return "sem_programacao";
  if (f.distanciaKm !== null && f.distanciaKm <= cfg.paradoDistKm) return "ok";
  const pertoDaHora = f.faltamMin <= cfg.paradoAteMin;
  const longe = f.distanciaKm !== null && f.distanciaKm > cfg.paradoDistKm;
  if (pertoDaHora && longe && f.posicao) {
    if (f.posicao.minutosSemAtualizar > cfg.semSinalMin) return "sem_sinal";
    if (f.paradoHaMin !== null && f.paradoHaMin > cfg.paradoMin) return "parado";
  }
  if (f.folgaMin !== null) {
    if (f.folgaMin < 0) return "atraso";
    if (f.folgaMin < cfg.margemMin) return "atencao";
  }
  return "ok";
}
