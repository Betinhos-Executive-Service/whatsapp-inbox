export type Coord = { lat: number; lon: number };

export type OsVigiada = {
  id: string;
  /** `cr40f_id`, ex.: "OS-1234". */
  numero: string | null;
  /** Horário de saída (epoch ms). */
  saidaAt: number;
  /** Endereço de embarque já extraído da primeira linha de `cr40f_endereodesada`. */
  endereco: string | null;
  cliente: string | null;
  passageiros: string | null;
  motorista: string | null;
  placa: string | null;
};

export type Posicao = {
  placa: string;
  lat: number;
  lon: number;
  endereco: string | null;
  velocidadeKmh: number;
  ignicao: boolean;
  /** Última atualização da Infleet (epoch ms). */
  fixAt: number;
  motorista: string | null;
};

export type Rota = { minutos: number; km: number; semTransito: boolean };

export type Nivel = "ok" | "sem_programacao" | "sem_sinal" | "parado" | "atraso" | "atencao";

export type ConfigRegras = {
  margemMin: number;
  rotaAteMin: number;
  paradoAteMin: number;
  paradoDistKm: number;
  paradoMin: number;
  semSinalMin: number;
};

export const CONFIG_REGRAS_PADRAO: ConfigRegras = { margemMin: 10, rotaAteMin: 60, paradoAteMin: 30, paradoDistKm: 1, paradoMin: 10, semSinalMin: 10 };

export type Fatos = {
  os: string;
  cliente: string | null;
  passageiros: string | null;
  motorista: string | null;
  placa: string | null;
  embarque: string | null;
  saidaAt: number;
  faltamMin: number;
  posicao: { endereco: string | null; minutosSemAtualizar: number; velocidadeKmh: number } | null;
  distanciaKm: number | null;
  trajetoMin: number | null;
  chegadaAt: number | null;
  /** Positivo = chega antes do horário; negativo = atraso. */
  folgaMin: number | null;
  semTransito: boolean;
  paradoHaMin: number | null;
};

export type Avaliacao = { osId: string; nivel: Nivel; fatos: Fatos };

/** Desde quando o carro está parado no mesmo ponto (memória do job entre ciclos). */
export type Parada = { lat: number; lon: number; desdeAt: number };

export type EntradaAvaliacao = {
  os: OsVigiada;
  posicao: Posicao | null;
  rota: Rota | null;
  embarque: Coord | null;
  parada: Parada | null;
  agora: number;
  cfg: ConfigRegras;
};
