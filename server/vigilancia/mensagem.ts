// server/vigilancia/mensagem.ts
import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "../pricing.ts";
import type { Avaliacao, Nivel } from "./tipos.ts";

export const MODELO = "claude-opus-5-5";
const TZ = "America/Sao_Paulo";
const MAX_LINHAS = 12;

export const SISTEMA = `Você redige avisos curtos para o grupo de operação da Betinhos Executive Service (transporte executivo) no WhatsApp.
Receberá, em JSON, os fatos de uma ordem de serviço (OS) e o nível de risco já decidido pelo sistema. Não reavalie o risco nem invente dados: use só o que está nos fatos.
Formato WhatsApp: primeira linha em *negrito* com o emoji do nível e o número da OS; depois marcadores "•" com cliente/passageiro, motorista/placa, embarque (horário e endereço) e a situação do carro (onde está, previsão de chegada, folga ou atraso em minutos). Termine com uma frase curta do que a operação deve fazer agora (ex.: ligar para o motorista, avisar o cliente, escalar outro carro).
Níveis e emojis: atraso ⚠️ "Risco de atraso"; atencao 🕒 "Atenção"; sem_sinal 📵 "Sem sinal"; parado 🛑 "Carro parado"; sem_programacao ❗ "Sem programação"; ok ✅ "Normalizou".
Tom humano, preciso e seguro. Sem saudação, sem introdução, sem explicar o que você é. Horários no formato HH:MM (fuso de São Paulo já aplicado nos fatos). Quando "semTransito" for true, diga que o tempo é sem trânsito. No máximo 6 linhas. Responda só com a mensagem.`;

export const hora = (ms: number): string => new Date(ms).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

const TITULO: Record<Nivel, string> = {
  atraso: "*⚠️ Risco de atraso — ",
  atencao: "*🕒 Atenção — ",
  sem_sinal: "*📵 Sem sinal — ",
  parado: "*🛑 Carro parado — ",
  sem_programacao: "*❗ Sem programação — ",
  ok: "*✅ Normalizou — ",
};

/** Mensagem fixa com os mesmos fatos, usada quando a API não responde. */
export function templateReserva({ nivel, fatos: f }: Avaliacao): string {
  const linhas = [
    `${TITULO[nivel]}${f.os}*`,
    `• Cliente: ${f.cliente ?? "—"} · Passageiro: ${f.passageiros ?? "—"}`,
    `• Motorista: ${f.motorista ?? "—"} · Placa ${f.placa ?? "—"}`,
    `• Embarque ${hora(f.saidaAt)} em ${f.embarque ?? "endereço não informado"}`,
  ];
  const transito = f.semTransito ? "sem trânsito" : "com trânsito";
  if (nivel === "sem_sinal" && f.posicao) linhas.push(`• Última posição em ${f.posicao.endereco ?? "local desconhecido"}, sem atualizar há ${f.posicao.minutosSemAtualizar} min`);
  else if (nivel === "parado" && f.posicao) linhas.push(`• Carro em ${f.posicao.endereco ?? "local desconhecido"}, parado há ${f.paradoHaMin ?? "?"} min a ${f.distanciaKm ?? "?"} km do embarque`);
  else if (nivel === "sem_programacao") linhas.push(`• Faltam ${f.faltamMin} min e a OS está sem ${!f.motorista && !f.placa ? "motorista e veículo" : !f.motorista ? "motorista" : "veículo"}`);
  else if (f.chegadaAt !== null && f.folgaMin !== null && f.posicao) {
    const folga = f.folgaMin < 0 ? `${-f.folgaMin} min de atraso` : `${f.folgaMin} min de folga`;
    linhas.push(`• Carro em ${f.posicao.endereco ?? "local desconhecido"}, previsão ${hora(f.chegadaAt)} (${folga}, ${transito})`);
  }
  return linhas.join("\n");
}

export type Redacao = { texto: string; usage: TokenUsage | null; reserva: boolean; erro: string | null };

export class Redator {
  private readonly apiKey: () => string | null | undefined;
  private readonly api: (key: string) => Pick<Anthropic, "beta">;
  private readonly timeoutMs: number;

  constructor(
    apiKey: () => string | null | undefined,
    api: (key: string) => Pick<Anthropic, "beta"> = (key) => new Anthropic({ apiKey: key, maxRetries: 1 }),
    timeoutMs = 20_000,
  ) {
    this.apiKey = apiKey;
    this.api = api;
    this.timeoutMs = timeoutMs;
  }

  async redigir(av: Avaliacao): Promise<Redacao> {
    const reserva = templateReserva(av);
    const key = this.apiKey();
    if (!key) return { texto: reserva, usage: null, reserva: true, erro: "Chave da API da Anthropic não configurada." };
    try {
      const res = await this.api(key).beta.messages.create(
        {
          model: MODELO,
          max_tokens: 1024,
          cache_control: { type: "ephemeral" },
          system: SISTEMA,
          messages: [{ role: "user", content: JSON.stringify({ nivel: av.nivel, ...av.fatos, saida: hora(av.fatos.saidaAt), chegadaPrevista: av.fatos.chegadaAt === null ? null : hora(av.fatos.chegadaAt) }, null, 1) }],
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: this.timeoutMs },
      );
      const u = res.usage;
      const cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const usage: TokenUsage = { inputTokens: u.input_tokens + cached, outputTokens: u.output_tokens, cachedTokens: u.cache_read_input_tokens ?? 0 };
      if (res.stop_reason === "refusal") return { texto: reserva, usage, reserva: true, erro: "O Claude recusou redigir o aviso." };
      const texto = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      if (!texto) return { texto: reserva, usage, reserva: true, erro: "O Claude não respondeu." };
      if (texto.split("\n").length > MAX_LINHAS) return { texto: reserva, usage, reserva: true, erro: "Resposta longa demais." };
      return { texto, usage, reserva: false, erro: null };
    } catch (e) {
      return { texto: reserva, usage: null, reserva: true, erro: (e as Error).message };
    }
  }
}
