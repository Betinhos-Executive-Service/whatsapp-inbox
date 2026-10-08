// Agente do botão Claude na conversa, em duas etapas com a pessoa no meio:
// 1. analisar: o Claude Code deste PC lê a conversa e o Dataverse de PROD (sem gravar) e monta o resumo;
// 2. agendar: só depois que a pessoa confere o resumo e clica em Agendar, cria a OS com a skill
//    assistente-betinhos e deixa na conversa o rascunho com o voucher em PDF e a mensagem de confirmação.
// Nada é enviado ao cliente: o rascunho espera a pessoa clicar em Enviar.
import { z } from "zod";
import type { Prompt } from "./ai.ts";
import type { Chat, Message } from "./db.ts";

/** Mensagens recentes que entram no pedido (o agente pode ler mais com ler_mensagens). */
export const AGENT_WINDOW = { messages: 60, chars: 1500 };
/** Consultar cadastros e histórico, criar a reserva e gerar o voucher leva alguns minutos. */
export const AGENT_TIMEOUT_MS = 900_000;

const DV = "mcp__Dataverse_PROD__";
const WA = "mcp__whatsapp-inbox__";
const READ = ["Skill", "Read(~/.claude/skills/**)", `${DV}read_query`, `${DV}search`, `${DV}describe`, `${WA}ler_mensagens`, `${WA}ler_midia`, `${WA}perfil_contato`];

/** Negado mesmo que as permissões globais do Claude Code liberem: alterar, excluir, DEV e terminal. */
const ALWAYS_DENIED = [
  "Bash",
  "PowerShell",
  "Write",
  "Edit",
  "NotebookEdit",
  `${DV}update_record`,
  `${DV}delete_record`,
  `${DV}create_table`,
  `${DV}update_table`,
  `${DV}delete_table`,
  `${DV}invoke_api`,
  `${DV}upsert_skill`,
  `${DV}delete_skill`,
  `${DV}create_skill_resource`,
  `${DV}init_file_upload`,
  `${DV}commit_file_upload`,
  "mcp__Dataverse_DEV",
  `${WA}marcar_lida`,
  `${WA}atualizar_conversa`,
  `${WA}abrir_conversa`,
  `${WA}propor_midia`,
];

export type AgentStep = "analisar" | "agendar";

/** Analisar só lê (e pode propor ao cliente o pedido dos dados que faltam); agendar cria e propõe o voucher. */
export const AGENT_TOOLS: Record<AgentStep, { allowed: string[]; disallowed: string[]; timeoutMs: number }> = {
  analisar: { allowed: [...READ, `${WA}propor_resposta`], disallowed: [...ALWAYS_DENIED, `${DV}create_record`, `${WA}propor_voucher`], timeoutMs: AGENT_TIMEOUT_MS },
  agendar: { allowed: [...READ, `${DV}create_record`, `${WA}propor_voucher`], disallowed: [...ALWAYS_DENIED, `${WA}propor_resposta`], timeoutMs: AGENT_TIMEOUT_MS },
};

const ANALYZE = `Você é o agente de agendamento do WhatsApp Inbox da Betinhos Executive Service.
A pessoa clicou no botão do Claude nesta conversa para PREPARAR um agendamento. Nesta etapa você só lê: não grave nada no Dataverse. A pessoa vai conferir o seu resumo no app e só então decidir se agenda.

1. Carregue a skill assistente-betinhos (ferramenta Skill) e siga os passos 1 a 5 do fluxo de agendamento (entender o pedido, resolver cadastros, inferir padrões pelo histórico, checar duplicidade, montar o resumo), lendo references/campos.md e references/consultas.md. Ninguém responde perguntas agora.
2. Leia a conversa abaixo. O pedido atual é o das mensagens mais recentes. Áudio e imagem: ler_midia; mais histórico: ler_mensagens.
3. Classifique:
   - "nao_e_agendamento": não é pedido de agendamento (cotação, dúvida, assunto operacional, conversa pessoal).
   - "faltam_dados": falta dado obrigatório ou há ambiguidade (cliente ou passageiro não encontrado ou com mais de um candidato, data ou hora, endereço de saída, destino, dados do voo em saída de Guarulhos, data no passado). Proponha ao cliente, com propor_resposta, uma mensagem curta pedindo só o que falta.
   - "ja_existia": já existe serviço ativo igual (consulta de duplicidade). Liste as OS.
   - "pronto": dá para agendar. Ida e volta ou vários dias: um serviço por trecho.
4. Em "pronto", ponha em "plano" o que a etapa de gravação vai criar: para cada serviço, o payload de create_record de cr40f_reservadeveculos conforme "Payload de criação" de references/campos.md (sem cr40f_id, cr40f_idnovo, campos de passageiro e cr40f_iachaveidempotencia) e os passageiros (GUID de cr40f_bancodedados e nome) na ordem de embarque. Só GUIDs obtidos por consulta.

Responda no fim só com um JSON, sem texto antes ou depois:
{"resultado":"pronto|faltam_dados|ja_existia|nao_e_agendamento","resumo":"1 frase para a pessoa","previa":"resumo do passo 5 da skill para conferir, com *negrito* e marcadores •; vazio se não for pronto","os":["OS-1234"],"plano":{"servicos":[{"reserva":{},"passageiros":[{"id":"<guid>","nome":"Nome"}]}]}}`;

const SCHEDULE = `Você é o agente de agendamento do WhatsApp Inbox da Betinhos Executive Service.
A pessoa conferiu no app o resumo abaixo e clicou em "Agendar". Esse clique é a confirmação explícita do passo 5 da skill assistente-betinhos para criar estes serviços no Dataverse de PRODUÇÃO, com status Solicitado. Crie exatamente o que está no resumo e no plano aprovados: não acrescente nem mude dados. Se algo do plano não bater com o Dataverse (GUID inexistente, serviço igual criado nesse meio-tempo), não grave e explique no resumo.

1. Carregue a skill assistente-betinhos (ferramenta Skill) e siga os passos 6 a 8 do fluxo (criar com chave de idempotência, vincular passageiros, conferir) e TODAS as regras invioláveis, lendo references/campos.md, references/consultas.md e references/voucher.md.
2. Antes de criar, refaça a checagem de duplicidade. Se a ação aprovada for só gerar o voucher de OS existentes, não crie nada.
3. Depois, releia as OS no Dataverse e chame propor_voucher com os dados lidos (nunca suposições; campo vazio fica vazio). Na legenda, a mensagem de confirmação ao cliente no formato "Texto de confirmação (WhatsApp)" de references/voucher.md. OS sem número OS-xxxx válido não vai para o voucher: explique no resumo.
4. Nunca envie mensagem ao cliente: propor_voucher só cria um rascunho que a pessoa revisa e envia.

Responda no fim só com um JSON, sem texto antes ou depois:
{"resultado":"agendado|ja_existia|erro","os":["OS-1234"],"resumo":"até 2 frases para a pessoa: o que foi feito e o que conferir"}`;

const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const stamp = (ms: number) => fmt.format(new Date(ms)).replace(",", "");

function line(m: Message, chat: Chat): string {
  const author = m.fromMe ? "Betinhos" : chat.isGroup && m.sender ? m.sender.split("@")[0] : chat.name;
  const media = m.media ? ` {${m.media.type}${m.media.fileName ? ` ${m.media.fileName}` : ""}}` : "";
  const text = m.deleted ? "(apagada)" : m.text.slice(0, AGENT_WINDOW.chars);
  return `[${stamp(m.at)}] ${author}: ${text}${media}  #${m.id}`;
}

function header(chat: Chat, now: number): string {
  return `Conversa: ${chat.name}${chat.phone ? ` (+${chat.phone})` : ""}${chat.isGroup ? " · grupo" : ""}
jid (use nas ferramentas do WhatsApp Inbox): ${chat.jid}
Agora: ${stamp(now)} (America/Sao_Paulo)`;
}

/** A conversa vai pela entrada padrão (nunca pela linha de comando). */
export function analyzePrompt(chat: Chat, messages: Message[], now = Date.now()): Prompt {
  const recent = messages.filter((m) => m.kind !== "system").slice(-AGENT_WINDOW.messages);
  return {
    system: ANALYZE,
    user: `${header(chat, now)}

Mensagens recentes, mais antigas primeiro ("Betinhos" = nós):
${recent.map((m) => line(m, chat)).join("\n")}`,
  };
}

export function schedulePrompt(chat: Chat, analysis: Analysis, now = Date.now()): Prompt {
  const action =
    analysis.resultado === "ja_existia"
      ? `Ação aprovada: só gerar o voucher das OS existentes (${analysis.os.join(", ")}). Não crie nada.`
      : "Ação aprovada: agendar os serviços do plano.";
  return {
    system: SCHEDULE,
    user: `${header(chat, now)}

${action}

Resumo aprovado pela pessoa:
${analysis.previa || analysis.resumo}

Plano aprovado (JSON):
${JSON.stringify(analysis.plano ?? null)}`,
  };
}

const text = z.string().catch("");
const osList = z.array(z.string()).catch([]).transform((l) => l.slice(0, 20));

export const analysisSchema = z.object({
  resultado: z.enum(["pronto", "faltam_dados", "ja_existia", "nao_e_agendamento"]),
  resumo: text,
  previa: text,
  os: osList,
  plano: z.unknown().optional(),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const scheduleSchema = z.object({ resultado: z.enum(["agendado", "ja_existia", "erro"]), resumo: text, os: osList });
export type Scheduled = z.infer<typeof scheduleSchema>;

/** JSON da resposta: inteiro, dentro de bloco ```json ou do primeiro { ao último }. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  for (const candidate of [raw.trim(), fenced, raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // próximo formato
    }
  }
  return null;
}

/** Resposta fora do formato vira erro legível, com o começo do que o Claude disse. */
export function parseOutcome<T>(schema: z.ZodType<T>, raw: string): T {
  const parsed = schema.safeParse(extractJson(raw));
  if (parsed.success) return parsed.data;
  throw new Error(`O Claude respondeu fora do formato esperado: ${raw.trim().slice(0, 300)}`);
}
