// Prompts e proteções comuns aos provedores de IA (DeepSeek e Claude pelo plano).
import type { Message } from "./db.ts";

export const DEFAULT_INSTRUCTIONS =
  "Você responde pela Betinhos Executive Service, transporte executivo terrestre. Tom humano, preciso e seguro: cordial, direto, sem gírias e sem exagero. Frases curtas. Nunca invente preço, horário, placa ou nome de motorista: se faltar a informação, diga que vai confirmar.";

export type Summary = { resumo: string; pedido: string; proximoPasso: string };

function lastFromContact(messages: Message[]): string {
  return [...messages].reverse().find((m) => !m.fromMe && m.text.trim())?.text.slice(0, 400) ?? "";
}

/** Janela de conversa enviada ao modelo: quantas mensagens recentes e quantos caracteres por mensagem. */
export type Window = { messages: number; chars: number };
/** Janela padrão; cada provedor passa a sua. */
export const DEFAULT_WINDOW: Window = { messages: 40, chars: 600 };

function transcript(contactName: string, messages: Message[], withTime = false, window: Window = DEFAULT_WINDOW): string {
  const when = (at: number) =>
    new Date(at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return messages
    .filter((m) => m.text.trim())
    .slice(-window.messages)
    .map((m) => `${withTime ? `[${when(m.at)}] ` : ""}${m.fromMe ? "Eu" : contactName}: ${m.text.slice(0, window.chars)}`)
    .join("\n");
}

export type Prompt = { system: string; user: string };

const DRAFT_RULES = `Escreva em português do Brasil. Responda só com o texto da mensagem, sem aspas, sem explicações e sem assinatura.
Use apenas informações que estão na conversa. Se pedirem preço, valor, horário, placa ou motorista e isso não estiver na conversa, diga que vai confirmar e retornar. Não escreva números que não estejam na conversa.
Acompanhe o tom da conversa: com amigos e família, informal e curto; com clientes, cordial e profissional.`;

/** Pedido de rascunho. withTime: data/hora em cada mensagem (o modelo da nuvem usa bem; o local se confunde). */
export function draftPrompt(contactName: string, messages: Message[], instructions: string, withTime = false, window: Window = DEFAULT_WINDOW): Prompt {
  return {
    system: `${instructions || DEFAULT_INSTRUCTIONS}\n${DRAFT_RULES}`,
    user: `Conversa de WhatsApp com ${contactName}${withTime ? " (mais antigas primeiro; as últimas são as que importam)" : ""}:\n${transcript(contactName, messages, withTime, window)}\n\nÚltima mensagem de ${contactName}: "${lastFromContact(messages)}"\n\nEscreva a minha próxima resposta, respondendo diretamente a essa última mensagem. Não repita o que eu já escrevi antes.`,
  };
}

export function summaryPrompt(contactName: string, messages: Message[], withTime = false, window: Window = DEFAULT_WINDOW): Prompt {
  return {
    system:
      "Você resume conversas de atendimento em português do Brasil, de forma objetiva. Use exatamente o formato pedido, com frases curtas e sem inventar fatos. O assunto atual é o das mensagens mais recentes; assuntos antigos já encerrados não entram no pedido nem no próximo passo.",
    user: `Conversa de WhatsApp com ${contactName}${withTime ? " (mais antigas primeiro)" : ""}:\n${transcript(contactName, messages, withTime, window)}\n\nÚltima mensagem de ${contactName}: "${lastFromContact(messages)}"\n\nResponda exatamente neste formato:\nRESUMO: <até 2 frases sobre o assunto atual da conversa>\nPEDIDO: <o que ${contactName} está pedindo ou perguntando e ainda não foi respondido; se nada estiver pendente, escreva "nada pendente">\nPRÓXIMO PASSO: <a ação que eu devo fazer agora, ou "nenhuma ação necessária">`,
  };
}

/** Tira as aspas que o modelo às vezes põe em volta do rascunho. */
export const unquote = (text: string) => text.replace(/^["“]|["”]$/g, "").trim();

/** Conversa sem horários, para a trava do rascunho (horário de envio não conta como dado citado). */
export const plainTranscript = (contactName: string, messages: Message[], window: Window = DEFAULT_WINDOW) => transcript(contactName, messages, false, window);

const PRICE = /(R\$\s*\d[\d.,]*|\b\d[\d.]*,\d{2}\b|\b\d+\s*(reais|mil)\b)/i;
const TIME = /\b([01]?\d|2[0-3])(h|:)[0-5]?\d?\b/i;
const PLATE = /\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/;
/** Pedido de dado sensível: o app nunca sugere pedir isso por WhatsApp. */
const SENSITIVE = /\b(cart[aã]o|cvv|c[oó]digo de seguran[cç]a|senha|cpf|rg|dados banc[aá]rios|n[uú]mero da conta)\b/i;
const fold = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "");

/**
 * Modelo pequeno às vezes inventa preço, horário ou placa. Toda frase do rascunho com um
 * desses dados que NÃO aparece na conversa sai, e entra um "vou confirmar".
 */
export function guardDraft(draft: string, conversation: string): string {
  const known = fold(conversation);
  let removedPrice = false;
  let removedOther = false;
  let removedSensitive = false;
  const sentences = draft.split(/(?<=[.!?])\s+/).filter((sentence) => {
    if (SENSITIVE.test(sentence) && !SENSITIVE.test(conversation)) {
      removedSensitive = true;
      return false;
    }
    for (const [re, isPrice] of [[PRICE, true], [TIME, false], [PLATE, false]] as const) {
      const m = sentence.match(re);
      if (m && !known.includes(fold(m[0]))) {
        if (isPrice) removedPrice = true;
        else removedOther = true;
        return false;
      }
    }
    return true;
  });
  let out = sentences.join(" ").trim();
  if (removedSensitive && !out) out = "Vou verificar e já te retorno.";
  if (removedPrice) out += (out ? " " : "") + "Vou confirmar o valor e já te retorno.";
  else if (removedOther) out += (out ? " " : "") + "Vou confirmar os detalhes e já te retorno.";
  return out;
}

/** O rascunho é (quase) igual a algo que eu já mandei nesta conversa? */
export function repeatsMine(draft: string, mine: string[]): boolean {
  const d = fold(draft);
  if (!d) return true;
  return mine.some((m) => {
    const t = fold(m);
    return t.length > 10 && (d === t || d.includes(t) || t.includes(d));
  });
}

/** Lê o formato "RESUMO: / PEDIDO: / PRÓXIMO PASSO:" com tolerância a variações do modelo. */
export function parseSummary(raw: string): Summary {
  const grab = (label: RegExp) => {
    const m = raw.match(label);
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  };
  // Os rótulos podem vir na mesma linha: o modelo pequeno às vezes não quebra linha.
  const resumo = grab(/RESUMO\s*:\s*([\s\S]*?)(?=\s*PEDIDO\s*:|$)/i);
  const pedido = grab(/PEDIDO\s*:\s*([\s\S]*?)(?=\s*PR[ÓO]XIMO\s+PASSO\s*:|$)/i);
  const proximoPasso = grab(/PR[ÓO]XIMO\s+PASSO\s*:\s*([\s\S]*)$/i);
  return { resumo: resumo || raw.trim().slice(0, 400), pedido, proximoPasso };
}
