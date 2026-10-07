import { Fragment, type ReactNode } from "react";
import { parseWa, type WaNode } from "./wa-text.ts";

const TAG = { b: "strong", i: "em", s: "s", code: "code", mono: "code" } as const;

function inline(nodes: WaNode[], live: boolean, key = ""): ReactNode[] {
  return nodes.map((n, idx) => {
    const k = `${key}${idx}`;
    if (typeof n === "string") return <Fragment key={k}>{n}</Fragment>;
    const Tag = live ? "span" : TAG[n.kind];
    const body = inline(n.children, live, `${k}.`);
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

const LIST = /^(\s*)([-*•]|\d{1,3}\.)\s+(.*)$/;

/** Texto de mensagem com formatação do WhatsApp (negrito, itálico, tachado, código, citação e listas). */
export function WaText({ text }: { text: string }) {
  if (text.includes("```")) return <>{inline(parseWa(text), false)}</>;
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, idx) => {
        const end = idx < lines.length - 1 ? "\n" : null;
        if (line.startsWith("> ")) {
          return (
            <span key={idx} className="wa-quote">
              {inline(parseWa(line.slice(2)), false)}
            </span>
          );
        }
        const list = LIST.exec(line);
        if (list) {
          const bullet = /\d/.test(list[2]) ? list[2] : "•";
          return (
            <span key={idx} className="wa-list">
              <span className="wa-list__mark">{bullet}</span>
              <span>{inline(parseWa(list[3]), false)}</span>
            </span>
          );
        }
        return (
          <Fragment key={idx}>
            {inline(parseWa(line), false)}
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

/** Só a formatação em linha — prévia da lista e citação. */
export function WaInline({ text }: { text: string }) {
  return <>{inline(parseWa(text), false)}</>;
}
