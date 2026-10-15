import { Fragment, useMemo, type ReactNode } from "react";
import { mentionPattern } from "./mentions.ts";
import { parseWa, splitLinks, type WaNode } from "./wa-text.ts";

const MENTION = mentionPattern();

const TAG = { b: "strong", i: "em", s: "s", code: "code", mono: "code" } as const;

function inline(nodes: WaNode[], live: boolean, key = "", pattern = MENTION): ReactNode[] {
  return nodes.map((n, idx) => {
    const k = `${key}${idx}`;
    if (typeof n === "string") return <Fragment key={k}>{live ? n : linked(n, k, pattern)}</Fragment>;
    const Tag = live ? "span" : TAG[n.kind];
    const body = inline(n.children, live, `${k}.`, pattern);
    if (!live) return <Tag key={k} className={`wa wa--${n.kind}`}>{body}</Tag>;
    // No composer os marcadores continuam visíveis (esmaecidos), como no WhatsApp.
    return (
      <span key={k} className={`wa wa--${n.kind} wa--live`}>
        <span className="wa-mark">{n.marker}</span>
        {body}
        <span className="wa-mark">{n.marker}</span>
      </span>
    );
  });
}

/** Links clicáveis; abrem fora do app (navegador padrão). */
function linked(text: string, key: string, pattern: RegExp): ReactNode {
  const parts = splitLinks(text);
  if (parts.length === 1 && typeof parts[0] === "string") return mentioned(text, key, pattern);
  return parts.map((p, idx) =>
    typeof p === "string" ? (
      <Fragment key={`${key}-${idx}`}>{mentioned(p, `${key}-${idx}`, pattern)}</Fragment>
    ) : (
      <a key={`${key}-${idx}`} className="wa-link" href={p.href} target="_blank" rel="noopener noreferrer" title={p.href}>
        {p.url}
      </a>
    ),
  );
}

/** "@nome" e "@5511…" viram chip destacado, como no WhatsApp. */
function mentioned(text: string, key: string, pattern: RegExp): ReactNode {
  if (!text.includes("@")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index! + m[1].length;
    out.push(text.slice(last, at));
    out.push(<span key={`${key}@${at}`} className="wa-mention">{m[2]}</span>);
    last = at + m[2].length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}

const LIST = /^(\s*)([-*•]|\d{1,3}\.)\s+(.*)$/;

/** Texto de mensagem com formatação do WhatsApp (negrito, itálico, tachado, código, citação e listas). `mentions`: nomes conhecidos, para "@Nome Sobrenome" destacar inteiro. */
export function WaText({ text, mentions }: { text: string; mentions?: readonly string[] }) {
  const pattern = useMemo(() => mentionPattern(mentions), [mentions]);
  if (text.includes("```")) return <>{inline(parseWa(text), false, "", pattern)}</>;
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, idx) => {
        const end = idx < lines.length - 1 ? "\n" : null;
        if (line.startsWith("> ")) {
          return (
            <span key={idx} className="wa-quote">
              {inline(parseWa(line.slice(2)), false, "", pattern)}
            </span>
          );
        }
        const list = LIST.exec(line);
        if (list) {
          const bullet = /\d/.test(list[2]) ? list[2] : "•";
          return (
            <span key={idx} className="wa-list">
              <span className="wa-list__mark">{bullet}</span>
              <span>{inline(parseWa(list[3]), false, "", pattern)}</span>
            </span>
          );
        }
        return (
          <Fragment key={idx}>
            {inline(parseWa(line), false, "", pattern)}
            {end}
          </Fragment>
        );
      })}
    </>
  );
}

/** Espelho do composer: mesmo texto e mesma largura de caracteres, com o estilo aplicado por baixo do textarea. */
export function WaLive({ text }: { text: string }) {
  // O "\n" final garante a mesma altura do textarea quando o texto termina em quebra de linha.
  return <>{inline(parseWa(text), true)}{"\n"}</>;
}

/** Só a formatação em linha — prévia da lista e citação. Quebras viram espaço: bloco ``` (pre-wrap) não pode furar o corte em uma linha. */
export function WaInline({ text }: { text: string }) {
  return <>{inline(parseWa(text.replace(/\s*\n\s*/g, " ")), false)}</>;
}
