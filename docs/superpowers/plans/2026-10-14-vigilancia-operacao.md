# Vigilância da Operação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cada 5 minutos, cruzar as OS das próximas 2 horas (Dataverse PROD) com a posição da frota (Infleet) e o tempo de trajeto com trânsito (TomTom, OSRM de reserva) e avisar o grupo da operação no WhatsApp só quando uma OS entra em risco ou muda de nível.

**Architecture:** Módulo `server/vigilancia/` dentro do WhatsApp Inbox. Regras puras decidem o nível de risco; a API da Anthropic só redige a mensagem (template fixo em falha). Estado por OS em SQLite (`inbox.db`), envio pelo `WhatsApp.send` já existente, configuração em `settings` com aba própria na tela de Configurações.

**Tech Stack:** Node 24 (TypeScript executado direto, `node --test`), `node:sqlite`, `@anthropic-ai/sdk` 0.133 (já instalado), zod 4, React 19 (UI), `fetch` nativo.

**Spec:** `docs/superpowers/specs/2026-10-14-vigilancia-operacao-design.md`

## Global Constraints

- Comandos: `pnpm test` (`node --test tests/*.test.ts`) e `pnpm typecheck` (`tsc --noEmit`). A worktree não tem `node_modules`: rode `pnpm install --offline` (ou `pnpm install`) uma vez antes da Tarefa 1.
- Testes em `tests/*.test.ts` com `node:test` + `node:assert/strict`; sem framework extra. `fetch` é sempre injetado (`fetchFn`) para mockar.
- Textos de UI e mensagens em pt-BR com acentos (UTF-8). Formato WhatsApp: `*negrito*`, marcadores `•`, parágrafos curtos, sem introdução.
- Modelo da API: `claude-opus-5-5`, `output_config.effort: "low"`, `max_tokens: 1024`, timeout 20 s, `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"` (mesmo padrão de `server/claude.ts`).
- Segredos nunca em log, resposta HTTP ou commit. `.env.local` já está no `.gitignore`.
- Commits em português, detalhados, terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Horário exibido em `America/Sao_Paulo`. Datas internas em epoch ms.
- Valores de status do Dataverse (`cr40f_status`): Cancelado `202410002`, Cancelado com Ressalvas `202410010`, Concluído `202410008` ficam fora da janela. Campo de endereço de saída: `cr40f_endereodesada` (texto `1. Nome - endereço`, uma linha por passageiro). Passageiros: `cr40f_passageirosetelefonedecontato`. Número da OS: `cr40f_id`. Placa: `cr40f_veiculos.cr40f_placa`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server/vigilancia/tipos.ts` | Tipos compartilhados e config padrão das regras |
| `server/vigilancia/regras.ts` | `avaliar`, `marcarParada`, `deveEnviar` (puras) |
| `server/vigilancia/geo.ts` | `distanciaKm`, `Geocodificador` (Nominatim + cache), `Roteador` (TomTom → OSRM) |
| `server/vigilancia/dataverse.ts` | Token client credentials, consulta de OS e veículos, `extrairEmbarque` |
| `server/vigilancia/infleet.ts` | Frota inteira pela GraphQL, `normalizarPlaca` |
| `server/vigilancia/mensagem.ts` | `templateReserva`, `Redator` (API Anthropic) |
| `server/vigilancia/job.ts` | `Vigilancia`: ciclo, agendador, contador de falhas por fonte |
| `server/vigilancia/index.ts` | `lerConfig` (settings/env → config), `criarVigilancia` |
| `server/db.ts` | Tabelas `vigilancia_alertas`, `vigilancia_geocache`; kind `vigilancia` em `ai_usage` |
| `server/pricing.ts` | `UsageKind` ganha `"vigilancia"` |
| `server/app.ts`, `server/http.ts`, `tests/fake-api.ts` | Rotas `/api/vigilancia*`, ciclo de vida |
| `ui/api.ts`, `ui/settings.tsx`, `ui/vigilancia.tsx`, `ui/ai-usage.tsx` | Aba "Vigilância" |
| `README.md` | Seção "Vigilância da operação" |

---

### Task 1: Tipos e regras puras

**Files:**
- Create: `server/vigilancia/tipos.ts`
- Create: `server/vigilancia/regras.ts`
- Test: `tests/vigilancia-regras.test.ts`

**Interfaces:**
- Produces: tipos abaixo; `avaliar(entrada: EntradaAvaliacao): Avaliacao`; `marcarParada(anterior: Parada | undefined, atual: Posicao): Parada`; `deveEnviar(anterior: Nivel | null, atual: Nivel): boolean`.

- [ ] **Step 1: Criar os tipos**

```ts
// server/vigilancia/tipos.ts
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
```

- [ ] **Step 2: Escrever os testes das regras (falhando)**

```ts
// tests/vigilancia-regras.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { avaliar, deveEnviar, marcarParada } from "../server/vigilancia/regras.ts";
import { CONFIG_REGRAS_PADRAO, type OsVigiada, type Posicao } from "../server/vigilancia/tipos.ts";

const AGORA = Date.UTC(2026, 9, 14, 16, 0); // 13:00 em São Paulo
const MIN = 60_000;
const os = (over: Partial<OsVigiada> = {}): OsVigiada => ({
  id: "os-1", numero: "OS-1234", saidaAt: AGORA + 40 * MIN, endereco: "Av. Paulista, 1000", cliente: "Acme", passageiros: "Fulano", motorista: "Beto", placa: "ABC1D23", ...over,
});
const pos = (over: Partial<Posicao> = {}): Posicao => ({ placa: "ABC1D23", lat: -23.6, lon: -46.7, endereco: "Rod. Castello Branco", velocidadeKmh: 60, ignicao: true, fixAt: AGORA - 1 * MIN, motorista: "Beto", ...over });
const embarque = { lat: -23.5614, lon: -46.6559 };
const base = { os: os(), posicao: pos(), rota: { minutos: 20, km: 15, semTransito: false }, embarque, parada: null, agora: AGORA, cfg: CONFIG_REGRAS_PADRAO };

test("regras: chega com folga maior que a margem é ok", () => {
  const a = avaliar(base);
  assert.equal(a.nivel, "ok");
  assert.equal(a.fatos.folgaMin, 20);
  assert.equal(a.fatos.chegadaAt, AGORA + 20 * MIN);
});

test("regras: folga menor que a margem é atenção", () => {
  assert.equal(avaliar({ ...base, rota: { minutos: 35, km: 30, semTransito: false } }).nivel, "atencao");
});

test("regras: previsão depois do horário é atraso, com folga negativa", () => {
  const a = avaliar({ ...base, rota: { minutos: 52, km: 40, semTransito: true } });
  assert.equal(a.nivel, "atraso");
  assert.equal(a.fatos.folgaMin, -12);
  assert.equal(a.fatos.semTransito, true);
});

test("regras: OS sem motorista ou sem veículo é sem_programacao, antes de qualquer outra regra", () => {
  assert.equal(avaliar({ ...base, os: os({ motorista: null }) }).nivel, "sem_programacao");
  assert.equal(avaliar({ ...base, os: os({ placa: null }), posicao: null }).nivel, "sem_programacao");
});

test("regras: carro a menos de 1 km do embarque é ok mesmo parado", () => {
  const a = avaliar({ ...base, os: os({ saidaAt: AGORA + 5 * MIN }), posicao: pos({ lat: -23.5620, lon: -46.6565, velocidadeKmh: 0, ignicao: false }), parada: { lat: -23.562, lon: -46.6565, desdeAt: AGORA - 30 * MIN }, rota: null });
  assert.equal(a.nivel, "ok");
  assert.ok((a.fatos.distanciaKm ?? 99) < 1);
});

test("regras: sem sinal há mais de 10 min a menos de 30 min do embarque", () => {
  const a = avaliar({ ...base, os: os({ saidaAt: AGORA + 25 * MIN }), posicao: pos({ fixAt: AGORA - 15 * MIN }), rota: null });
  assert.equal(a.nivel, "sem_sinal");
  assert.equal(a.fatos.posicao?.minutosSemAtualizar, 15);
});

test("regras: parado há mais de 10 min longe do embarque perto da hora", () => {
  const a = avaliar({ ...base, os: os({ saidaAt: AGORA + 25 * MIN }), posicao: pos({ velocidadeKmh: 0, ignicao: false }), parada: { lat: -23.6, lon: -46.7, desdeAt: AGORA - 12 * MIN }, rota: null });
  assert.equal(a.nivel, "parado");
  assert.equal(a.fatos.paradoHaMin, 12);
});

test("regras: parado sem histórico não dispara; longe da hora também não", () => {
  assert.equal(avaliar({ ...base, os: os({ saidaAt: AGORA + 25 * MIN }), posicao: pos({ velocidadeKmh: 0, ignicao: false }), parada: null, rota: null }).nivel, "ok");
  assert.equal(avaliar({ ...base, os: os({ saidaAt: AGORA + 50 * MIN }), posicao: pos({ velocidadeKmh: 0, ignicao: false }), parada: { lat: -23.6, lon: -46.7, desdeAt: AGORA - 30 * MIN }, rota: null }).nivel, "ok");
});

test("regras: sem rota e sem posição só valem as regras de programação", () => {
  const a = avaliar({ ...base, posicao: null, rota: null, embarque: null });
  assert.equal(a.nivel, "ok");
  assert.equal(a.fatos.trajetoMin, null);
  assert.equal(a.fatos.distanciaKm, null);
});

test("marcarParada: mantém o início enquanto o carro não anda; reinicia ao mover ou ligar", () => {
  const p0 = marcarParada(undefined, pos({ velocidadeKmh: 0, ignicao: false, fixAt: AGORA - 20 * MIN }));
  assert.equal(p0.desdeAt, AGORA - 20 * MIN);
  const p1 = marcarParada(p0, pos({ velocidadeKmh: 0, ignicao: false, fixAt: AGORA - 5 * MIN, lat: -23.6001, lon: -46.7001 }));
  assert.equal(p1.desdeAt, AGORA - 20 * MIN);
  const p2 = marcarParada(p1, pos({ velocidadeKmh: 30, ignicao: true, fixAt: AGORA }));
  assert.equal(p2.desdeAt, AGORA);
  const p3 = marcarParada(p2, pos({ velocidadeKmh: 0, ignicao: false, fixAt: AGORA + MIN, lat: -23.61, lon: -46.71 }));
  assert.equal(p3.desdeAt, AGORA + MIN);
});

test("deveEnviar: só em mudança de nível, sem avisar ok sem alerta anterior nem atenção depois de atraso", () => {
  assert.equal(deveEnviar(null, "ok"), false);
  assert.equal(deveEnviar(null, "atencao"), true);
  assert.equal(deveEnviar("atencao", "atencao"), false);
  assert.equal(deveEnviar("atencao", "atraso"), true);
  assert.equal(deveEnviar("atraso", "atencao"), false);
  assert.equal(deveEnviar("atraso", "ok"), true);
  assert.equal(deveEnviar("ok", "sem_sinal"), true);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/vigilancia-regras.test.ts`
Expected: falha com "Cannot find module .../regras.ts".

- [ ] **Step 4: Implementar as regras**

```ts
// server/vigilancia/regras.ts
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/vigilancia-regras.test.ts`
Expected: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add server/vigilancia/tipos.ts server/vigilancia/regras.ts tests/vigilancia-regras.test.ts
git commit -m "feat(vigilância): tipos e regras puras de risco de atraso

Níveis sem_programacao, sem_sinal, parado, atraso, atencao e ok, com
prioridade fixa, memória de parada entre ciclos e decisão de envio só em
mudança de nível.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Estado e cache em SQLite

**Files:**
- Modify: `server/db.ts` (SCHEMA após `ai_usage`; `migrateUsageProviders`; métodos novos no fim da classe `Store`)
- Modify: `server/pricing.ts:5`
- Modify: `ui/ai-usage.tsx:20`
- Test: `tests/vigilancia-estado.test.ts`

**Interfaces:**
- Produces (em `Store`): `vigilanciaNivel(osId: string): Nivel | null`; `vigilanciaRegistrar(osId: string, nivel: Nivel, saidaAt: number, at: number): void`; `vigilanciaLimpar(saidaAntesDe: number): number`; `geocacheGet(endereco: string): Coord | null`; `geocacheSet(endereco: string, coord: Coord, at: number): void`.
- `UsageKind` passa a incluir `"vigilancia"`; `ai_usage.kind` aceita `'vigilancia'`.

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/vigilancia-estado.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";

test("estado: registra, lê e limpa níveis por OS", () => {
  const s = new Store(":memory:");
  assert.equal(s.vigilanciaNivel("os-1"), null);
  s.vigilanciaRegistrar("os-1", "atencao", 1_000, 500);
  s.vigilanciaRegistrar("os-2", "atraso", 5_000, 500);
  assert.equal(s.vigilanciaNivel("os-1"), "atencao");
  s.vigilanciaRegistrar("os-1", "atraso", 1_000, 600);
  assert.equal(s.vigilanciaNivel("os-1"), "atraso");
  assert.equal(s.vigilanciaLimpar(2_000), 1);
  assert.equal(s.vigilanciaNivel("os-1"), null);
  assert.equal(s.vigilanciaNivel("os-2"), "atraso");
});

test("geocache: guarda coordenadas por endereço", () => {
  const s = new Store(":memory:");
  assert.equal(s.geocacheGet("Av. Paulista, 1000"), null);
  s.geocacheSet("Av. Paulista, 1000", { lat: -23.56, lon: -46.65 }, 1);
  assert.deepEqual(s.geocacheGet("Av. Paulista, 1000"), { lat: -23.56, lon: -46.65 });
});

test("ai_usage aceita o kind vigilancia, inclusive em banco antigo", () => {
  const s = new Store(":memory:");
  s.recordAiUsage({ at: 1, provider: "claude", kind: "vigilancia", chatJid: "g@g.us", model: "claude-opus-5-5", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 }, costUsd: 0.001, label: null, confidence: null, needsReply: null, urgent: null, ok: true });
  const n = s.db.prepare("select count(*) n from ai_usage where kind = 'vigilancia'").get() as { n: number };
  assert.equal(n.n, 1);
  // Banco antigo: tabela sem 'vigilancia' no check é recriada mantendo os dados.
  const velho = new Store(":memory:");
  velho.db.exec(`drop table ai_usage; create table ai_usage (
    id integer primary key, at integer not null,
    provider text not null check (provider in ('jev','deepseek','local','claude')),
    kind text not null check (kind in ('classificar','rascunho','resumo')),
    chat_jid text, model text not null, input_tokens integer not null default 0, output_tokens integer not null default 0,
    cached_tokens integer not null default 0, cost_usd real not null default 0, label text, confidence real, needs_reply real, urgent real, ok integer not null default 1);
    insert into ai_usage (at, provider, kind, model) values (1, 'jev', 'classificar', 'jev');`);
  // @ts-expect-error método privado exercitado de propósito
  velho.migrateUsageProviders();
  velho.recordAiUsage({ at: 2, provider: "claude", kind: "vigilancia", chatJid: null, model: "claude-opus-5-5", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, costUsd: 0, label: null, confidence: null, needsReply: null, urgent: null, ok: true });
  const total = velho.db.prepare("select count(*) n from ai_usage").get() as { n: number };
  assert.equal(total.n, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vigilancia-estado.test.ts`
Expected: falha com "vigilanciaNivel is not a function".

- [ ] **Step 3: Implementar**

Em `server/pricing.ts` linha 5:

```ts
export type UsageKind = "classificar" | "rascunho" | "resumo" | "vigilancia";
```

Em `ui/ai-usage.tsx` linha 20:

```ts
const KIND_LABEL = { classificar: "Classificação (Jev)", rascunho: "Rascunho de resposta", resumo: "Resumo da conversa", vigilancia: "Vigilância da operação" } as const;
```

Em `server/db.ts`, no `SCHEMA`, trocar a linha do check de `kind`:

```sql
  kind text not null check (kind in ('classificar','rascunho','resumo','vigilancia')),
```

e acrescentar logo após `create index if not exists ai_usage_chat on ai_usage(chat_jid);`:

```sql
create table if not exists vigilancia_alertas (
  os_id text primary key,
  nivel text not null,
  saida_at integer not null,
  enviado_em integer not null
);
create table if not exists vigilancia_geocache (
  endereco text primary key,
  lat real not null,
  lon real not null,
  criado_em integer not null
);
```

Em `migrateUsageProviders`, trocar a condição de saída para cobrir os dois checks:

```ts
    if (!row || (String(row.sql).includes("'claude'") && String(row.sql).includes("'vigilancia'"))) return;
```

e atualizar o comentário do método: `/** Bancos antigos têm os checks de provider/kind sem 'claude' ou 'vigilancia': recria a tabela mantendo os dados. */`.

Acrescentar os imports no topo de `server/db.ts`:

```ts
import type { Coord, Nivel } from "./vigilancia/tipos.ts";
```

Métodos novos na classe `Store` (antes do fechamento da classe, depois da seção de gastos com IA):

```ts
  // ---- vigilância da operação

  vigilanciaNivel(osId: string): Nivel | null {
    const row = this.q("select nivel from vigilancia_alertas where os_id = ?").get(osId) as Row | undefined;
    return row ? (String(row.nivel) as Nivel) : null;
  }

  vigilanciaRegistrar(osId: string, nivel: Nivel, saidaAt: number, at: number): void {
    this.q(
      `insert into vigilancia_alertas (os_id, nivel, saida_at, enviado_em) values (?, ?, ?, ?)
       on conflict(os_id) do update set nivel = excluded.nivel, saida_at = excluded.saida_at, enviado_em = excluded.enviado_em`,
    ).run(osId, nivel, saidaAt, at);
  }

  /** Apaga o estado das OS cuja saída já passou; devolve quantas saíram. */
  vigilanciaLimpar(saidaAntesDe: number): number {
    return Number(this.q("delete from vigilancia_alertas where saida_at < ?").run(saidaAntesDe).changes);
  }

  geocacheGet(endereco: string): Coord | null {
    const row = this.q("select lat, lon from vigilancia_geocache where endereco = ?").get(endereco) as Row | undefined;
    return row ? { lat: Number(row.lat), lon: Number(row.lon) } : null;
  }

  geocacheSet(endereco: string, coord: Coord, at: number): void {
    this.q("insert or replace into vigilancia_geocache (endereco, lat, lon, criado_em) values (?, ?, ?, ?)").run(endereco, coord.lat, coord.lon, at);
  }
```

`Row` já existe em `db.ts` (tipo usado por `pragma table_info`); confirme com `rg -n "type Row" server/db.ts`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vigilancia-estado.test.ts tests/usage.test.ts`
Expected: passa, inclusive os testes antigos de gastos.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/pricing.ts ui/ai-usage.tsx tests/vigilancia-estado.test.ts
git commit -m "feat(vigilância): estado por OS, cache de geocodificação e kind vigilancia nos gastos

Tabelas vigilancia_alertas e vigilancia_geocache no inbox.db; ai_usage
aceita o kind 'vigilancia' (migração recria a tabela em bancos antigos).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Geocodificação e rota

**Files:**
- Create: `server/vigilancia/geo.ts`
- Test: `tests/vigilancia-geo.test.ts`

**Interfaces:**
- Consumes: `Store.geocacheGet/geocacheSet` (Task 2), `distanciaKm` (Task 1).
- Produces: `class Geocodificador { constructor(cache: GeocacheStore, fetchFn?: typeof fetch, esperar?: (ms) => Promise<void>, agora?: () => number); localizar(endereco: string): Promise<Coord | null> }`; `class Roteador { constructor(tomtomKey: string | null, fetchFn?: typeof fetch); rota(origem: Coord, destino: Coord): Promise<Rota | null> }`.

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/vigilancia-geo.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Geocodificador, Roteador } from "../server/vigilancia/geo.ts";
import type { Coord } from "../server/vigilancia/tipos.ts";

function cacheMemoria() {
  const m = new Map<string, Coord>();
  return { geocacheGet: (e: string) => m.get(e) ?? null, geocacheSet: (e: string, c: Coord) => void m.set(e, c), m };
}
const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("geocodificador: consulta a Nominatim uma vez e guarda no cache", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => (urls.push(u), resposta([{ lat: "-23.56", lon: "-46.65", display_name: "Av. Paulista" }]))) as typeof fetch;
  const cache = cacheMemoria();
  const g = new Geocodificador(cache, f, async () => undefined, () => 0);
  assert.deepEqual(await g.localizar("Av. Paulista, 1000"), { lat: -23.56, lon: -46.65 });
  assert.deepEqual(await g.localizar("Av. Paulista, 1000"), { lat: -23.56, lon: -46.65 });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /countrycodes=br/);
  assert.match(urls[0], /q=Av\.%20Paulista%2C%201000/);
});

test("geocodificador: endereço não encontrado devolve null e não repete por 60 min", async () => {
  let n = 0;
  const f = (async () => (n++, resposta([]))) as typeof fetch;
  let agora = 0;
  const g = new Geocodificador(cacheMemoria(), f, async () => undefined, () => agora);
  assert.equal(await g.localizar("Rua Inexistente 999"), null);
  assert.equal(await g.localizar("Rua Inexistente 999"), null);
  assert.equal(n, 1);
  agora = 61 * 60_000;
  assert.equal(await g.localizar("Rua Inexistente 999"), null);
  assert.equal(n, 2);
});

test("geocodificador: espera 1,1 s entre consultas de rede", async () => {
  const esperas: number[] = [];
  const f = (async () => resposta([{ lat: "1", lon: "2" }])) as typeof fetch;
  const g = new Geocodificador(cacheMemoria(), f, async (ms) => void esperas.push(ms), () => 0);
  await g.localizar("A");
  await g.localizar("B");
  assert.deepEqual(esperas, [1100]);
});

test("roteador: TomTom com trânsito quando há chave", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => (urls.push(u), resposta({ routes: [{ summary: { lengthInMeters: 15200, travelTimeInSeconds: 1500, trafficDelayInSeconds: 300 } }] }))) as typeof fetch;
  const r = new Roteador("chave", f);
  assert.deepEqual(await r.rota({ lat: -23.6, lon: -46.7 }, { lat: -23.56, lon: -46.65 }), { minutos: 25, km: 15.2, semTransito: false });
  assert.match(urls[0], /api\.tomtom\.com\/routing\/1\/calculateRoute\/-23\.6,-46\.7:-23\.56,-46\.65\/json\?/);
  assert.match(urls[0], /traffic=true/);
});

test("roteador: sem chave ou com TomTom fora cai no OSRM, marcado sem trânsito", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    if (u.includes("tomtom")) return resposta({}, 500);
    return resposta({ code: "Ok", routes: [{ distance: 15200, duration: 1200 }] });
  }) as typeof fetch;
  assert.deepEqual(await new Roteador("chave", f).rota({ lat: -23.6, lon: -46.7 }, { lat: -23.56, lon: -46.65 }), { minutos: 20, km: 15.2, semTransito: true });
  assert.equal(urls.filter((u) => u.includes("osrm")).length, 1);
  urls.length = 0;
  await new Roteador(null, f).rota({ lat: -23.6, lon: -46.7 }, { lat: -23.56, lon: -46.65 });
  assert.equal(urls.some((u) => u.includes("tomtom")), false);
});

test("roteador: TomTom e OSRM fora devolve null", async () => {
  const f = (async () => resposta({}, 500)) as typeof fetch;
  assert.equal(await new Roteador("chave", f).rota({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vigilancia-geo.test.ts`
Expected: falha com "Cannot find module .../geo.ts".

- [ ] **Step 3: Implementar**

```ts
// server/vigilancia/geo.ts
import type { Coord, Rota } from "./tipos.ts";

export type GeocacheStore = { geocacheGet(endereco: string): Coord | null; geocacheSet(endereco: string, coord: Coord, at: number): void };

const UA = "betinhos-whatsapp-inbox-vigilancia/1.0";
const INTERVALO_NOMINATIM_MS = 1100;
const REPETIR_FALHA_MS = 60 * 60_000;
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

/** Nominatim (1 req/s) com cache permanente dos acertos e memória de 60 min das falhas. */
export class Geocodificador {
  private readonly falhas = new Map<string, number>();
  private ultimaConsultaAt = -Infinity;

  constructor(
    private readonly cache: GeocacheStore,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly esperar: (ms: number) => Promise<void> = dormir,
    private readonly agora: () => number = Date.now,
  ) {}

  async localizar(endereco: string): Promise<Coord | null> {
    const chave = endereco.trim().replace(/\s+/g, " ");
    if (!chave) return null;
    const guardado = this.cache.geocacheGet(chave);
    if (guardado) return guardado;
    const falhouEm = this.falhas.get(chave);
    if (falhouEm !== undefined && this.agora() - falhouEm < REPETIR_FALHA_MS) return null;
    const desdeUltima = this.agora() - this.ultimaConsultaAt;
    if (desdeUltima < INTERVALO_NOMINATIM_MS) await this.esperar(INTERVALO_NOMINATIM_MS);
    this.ultimaConsultaAt = this.agora();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(chave)}`;
    const res = await this.fetchFn(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const [hit] = (await res.json()) as { lat: string; lon: string }[];
    if (!hit) {
      this.falhas.set(chave, this.agora());
      return null;
    }
    const coord = { lat: Number(hit.lat), lon: Number(hit.lon) };
    this.cache.geocacheSet(chave, coord, this.agora());
    return coord;
  }
}

/** TomTom (trânsito ao vivo) quando há chave; OSRM público (sem trânsito) de reserva. */
export class Roteador {
  constructor(
    private readonly tomtomKey: string | null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async rota(origem: Coord, destino: Coord): Promise<Rota | null> {
    if (this.tomtomKey) {
      try {
        return await this.tomtom(origem, destino, this.tomtomKey);
      } catch {
        // cai no OSRM
      }
    }
    try {
      return await this.osrm(origem, destino);
    } catch {
      return null;
    }
  }

  private async tomtom(o: Coord, d: Coord, chave: string): Promise<Rota> {
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${o.lat},${o.lon}:${d.lat},${d.lon}/json?key=${encodeURIComponent(chave)}&traffic=true&travelMode=car&routeRepresentation=summaryOnly`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
    const r = ((await res.json()) as { routes?: { summary: { lengthInMeters: number; travelTimeInSeconds: number } }[] }).routes?.[0];
    if (!r) throw new Error("TomTom sem rota");
    return { minutos: Math.round(r.summary.travelTimeInSeconds / 60), km: Math.round(r.summary.lengthInMeters / 100) / 10, semTransito: false };
  }

  private async osrm(o: Coord, d: Coord): Promise<Rota> {
    const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false`;
    const res = await this.fetchFn(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const j = (await res.json()) as { code: string; routes?: { distance: number; duration: number }[] };
    const r = j.code === "Ok" ? j.routes?.[0] : undefined;
    if (!r) throw new Error("OSRM sem rota");
    return { minutos: Math.round(r.duration / 60), km: Math.round(r.distance / 100) / 10, semTransito: true };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vigilancia-geo.test.ts`
Expected: passa.

- [ ] **Step 5: Commit**

```bash
git add server/vigilancia/geo.ts tests/vigilancia-geo.test.ts
git commit -m "feat(vigilância): geocodificação com cache e rota com trânsito

Nominatim a 1 req/s com cache em SQLite e memória de falhas; TomTom
Routing com trânsito ao vivo e OSRM de reserva marcado sem trânsito.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Dataverse (token e OS da janela)

**Files:**
- Create: `server/vigilancia/dataverse.ts`
- Test: `tests/vigilancia-dataverse.test.ts`

**Interfaces:**
- Produces: `type DataverseConfig = { url: string; tenantId: string; clientId: string; clientSecret: string }`; `class DataverseCliente { constructor(cfg, fetchFn?, agora?); osNaJanela(agora: number, janelaMin: number): Promise<OsVigiada[]> }`; `extrairEmbarque(texto: string | null): string | null`; `montarConsultaOs(agora: number, janelaMin: number): string`.

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/vigilancia-dataverse.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DataverseCliente, extrairEmbarque, montarConsultaOs } from "../server/vigilancia/dataverse.ts";

const CFG = { url: "https://org.crm2.dynamics.com", tenantId: "tenant", clientId: "cid", clientSecret: "segredo" };
const AGORA = Date.UTC(2026, 9, 14, 16, 0);
const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("extrairEmbarque: primeira linha sem o número e o nome do passageiro", () => {
  assert.equal(extrairEmbarque("1. Gabriela - Hotel Radisson Vila Olímpia\n2. João - Rua X, 10"), "Hotel Radisson Vila Olímpia");
  assert.equal(extrairEmbarque("1. Alvadi - Aeroporto de Guarulhos - Voo LA 8127"), "Aeroporto de Guarulhos - Voo LA 8127");
  assert.equal(extrairEmbarque("Av. Paulista, 1000"), "Av. Paulista, 1000");
  assert.equal(extrairEmbarque("  "), null);
  assert.equal(extrairEmbarque(null), null);
});

test("montarConsultaOs: janela, status excluídos e expands", () => {
  const q = montarConsultaOs(AGORA, 120);
  assert.match(q, /^cr40f_reservadeveculos\?/);
  assert.match(q, /cr40f_dataehorriodesada ge 2026-10-14T16:00:00\.000Z and cr40f_dataehorriodesada lt 2026-10-14T18:00:00\.000Z/);
  assert.match(q, /cr40f_status ne 202410002/);
  assert.match(q, /cr40f_status ne 202410010/);
  assert.match(q, /cr40f_status ne 202410008/);
  assert.match(q, /\$expand=cr40f_Motorista\(\$select=cr40f_nomecompleto,new_apelido\),cr40f_Cliente\(\$select=cr40f_nomedocliente\)/);
  assert.match(q, /\$orderby=cr40f_dataehorriodesada asc/);
});

test("DataverseCliente: pede token uma vez, consulta OS e veículos, monta OsVigiada", async () => {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.includes("login.microsoftonline.com/tenant/oauth2/v2.0/token")) return resposta({ access_token: "tok", expires_in: 3600 });
    if (url.includes("cr40f_reservadeveculos")) {
      return resposta({
        value: [
          { cr40f_reservadeveculosid: "os-1", cr40f_id: "OS-1234", cr40f_dataehorriodesada: "2026-10-14T17:00:00Z", cr40f_endereodesada: "1. Fulano - Av. Paulista, 1000", cr40f_passageirosetelefonedecontato: "Fulano (11 9999)", _cr40f_veiculo_value: "v-1", cr40f_Motorista: { cr40f_nomecompleto: "Roberto Silva", new_apelido: "Beto" }, cr40f_Cliente: { cr40f_nomedocliente: "Acme" } },
          { cr40f_reservadeveculosid: "os-2", cr40f_id: "OS-1235", cr40f_dataehorriodesada: "2026-10-14T17:30:00Z", cr40f_endereodesada: null, cr40f_passageirosetelefonedecontato: null, _cr40f_veiculo_value: null, cr40f_Motorista: null, cr40f_Cliente: null },
        ],
      });
    }
    if (url.includes("cr40f_veiculos")) return resposta({ value: [{ cr40f_veiculosid: "v-1", cr40f_placa: "ABC-1D23" }] });
    return resposta({}, 404);
  }) as typeof fetch;
  const dv = new DataverseCliente(CFG, f, () => AGORA);
  const lista = await dv.osNaJanela(AGORA, 120);
  assert.deepEqual(lista, [
    { id: "os-1", numero: "OS-1234", saidaAt: Date.UTC(2026, 9, 14, 17, 0), endereco: "Av. Paulista, 1000", cliente: "Acme", passageiros: "Fulano (11 9999)", motorista: "Beto", placa: "ABC-1D23" },
    { id: "os-2", numero: "OS-1235", saidaAt: Date.UTC(2026, 9, 14, 17, 30), endereco: null, cliente: null, passageiros: null, motorista: null, placa: null },
  ]);
  const token = chamadas[0];
  assert.match(String(token.init?.body), /grant_type=client_credentials/);
  assert.match(String(token.init?.body), /scope=https%3A%2F%2Forg\.crm2\.dynamics\.com%2F\.default/);
  const os = chamadas.find((c) => c.url.includes("cr40f_reservadeveculos"))!;
  assert.equal((os.init?.headers as Record<string, string>).authorization, "Bearer tok");
  assert.match(os.url, /^https:\/\/org\.crm2\.dynamics\.com\/api\/data\/v9\.2\/cr40f_reservadeveculos\?/);
  await dv.osNaJanela(AGORA + 60_000, 120);
  assert.equal(chamadas.filter((c) => c.url.includes("oauth2")).length, 1);
});

test("DataverseCliente: erro HTTP vira exceção com status, sem o corpo inteiro", async () => {
  const f = (async (url: string) => (url.includes("oauth2") ? resposta({ access_token: "tok", expires_in: 3600 }) : resposta({ error: { message: "x".repeat(2000) } }, 403))) as typeof fetch;
  await assert.rejects(new DataverseCliente(CFG, f).osNaJanela(AGORA, 120), /Dataverse HTTP 403/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vigilancia-dataverse.test.ts`
Expected: falha com "Cannot find module .../dataverse.ts".

- [ ] **Step 3: Implementar**

```ts
// server/vigilancia/dataverse.ts
import type { OsVigiada } from "./tipos.ts";

export type DataverseConfig = { url: string; tenantId: string; clientId: string; clientSecret: string };

const STATUS_FORA = [202410002, 202410010, 202410008]; // Cancelado, Cancelado com Ressalvas, Concluído
const SELECT_OS = "cr40f_reservadeveculosid,cr40f_id,cr40f_dataehorriodesada,cr40f_endereodesada,cr40f_passageirosetelefonedecontato,cr40f_status,_cr40f_veiculo_value";
const EXPAND_OS = "cr40f_Motorista($select=cr40f_nomecompleto,new_apelido),cr40f_Cliente($select=cr40f_nomedocliente)";

type LinhaOs = {
  cr40f_reservadeveculosid: string;
  cr40f_id: string | null;
  cr40f_dataehorriodesada: string;
  cr40f_endereodesada: string | null;
  cr40f_passageirosetelefonedecontato: string | null;
  _cr40f_veiculo_value: string | null;
  cr40f_Motorista: { cr40f_nomecompleto: string | null; new_apelido: string | null } | null;
  cr40f_Cliente: { cr40f_nomedocliente: string | null } | null;
};
type LinhaVeiculo = { cr40f_veiculosid: string; cr40f_placa: string | null };

/** Primeira linha de `cr40f_endereodesada` sem o `N. Nome - ` do passageiro. */
export function extrairEmbarque(texto: string | null): string | null {
  const linha = (texto ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!linha) return null;
  const semNumero = linha.replace(/^\d+\.\s*/, "");
  const sep = semNumero.indexOf(" - ");
  return (sep >= 0 ? semNumero.slice(sep + 3) : semNumero).trim() || null;
}

export function montarConsultaOs(agora: number, janelaMin: number): string {
  const ini = new Date(agora).toISOString();
  const fim = new Date(agora + janelaMin * 60_000).toISOString();
  const filtro = [`cr40f_dataehorriodesada ge ${ini}`, `cr40f_dataehorriodesada lt ${fim}`, ...STATUS_FORA.map((s) => `cr40f_status ne ${s}`)].join(" and ");
  return `cr40f_reservadeveculos?$select=${SELECT_OS}&$expand=${EXPAND_OS}&$filter=${filtro}&$orderby=cr40f_dataehorriodesada asc`;
}

export class DataverseCliente {
  private tokenCache: { valor: string; expiraAt: number } | null = null;

  constructor(
    private readonly cfg: DataverseConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly agora: () => number = Date.now,
  ) {}

  async osNaJanela(agora: number, janelaMin: number): Promise<OsVigiada[]> {
    const linhas = await this.get<LinhaOs>(montarConsultaOs(agora, janelaMin));
    const idsVeiculo = [...new Set(linhas.map((l) => l._cr40f_veiculo_value).filter((v): v is string => !!v))];
    const placas = new Map<string, string | null>();
    if (idsVeiculo.length) {
      const filtro = idsVeiculo.map((id) => `cr40f_veiculosid eq ${id}`).join(" or ");
      for (const v of await this.get<LinhaVeiculo>(`cr40f_veiculos?$select=cr40f_veiculosid,cr40f_placa&$filter=${filtro}`)) placas.set(v.cr40f_veiculosid, v.cr40f_placa);
    }
    return linhas.map((l) => ({
      id: l.cr40f_reservadeveculosid,
      numero: l.cr40f_id,
      saidaAt: new Date(l.cr40f_dataehorriodesada).getTime(),
      endereco: extrairEmbarque(l.cr40f_endereodesada),
      cliente: l.cr40f_Cliente?.cr40f_nomedocliente ?? null,
      passageiros: l.cr40f_passageirosetelefonedecontato,
      motorista: l.cr40f_Motorista ? (l.cr40f_Motorista.new_apelido || l.cr40f_Motorista.cr40f_nomecompleto) : null,
      placa: (l._cr40f_veiculo_value && placas.get(l._cr40f_veiculo_value)) || null,
    }));
  }

  private async get<T>(consulta: string): Promise<T[]> {
    const token = await this.token();
    const res = await this.fetchFn(`${this.cfg.url}/api/data/v9.2/${consulta}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json", "odata-maxversion": "4.0", "odata-version": "4.0" },
    });
    if (!res.ok) throw new Error(`Dataverse HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { value: T[] }).value;
  }

  private async token(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiraAt > this.agora()) return this.tokenCache.valor;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: `${this.cfg.url}/.default` });
    const res = await this.fetchFn(`https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!res.ok) throw new Error(`Entra ID HTTP ${res.status}: token do Dataverse recusado`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = { valor: j.access_token, expiraAt: this.agora() + (j.expires_in - 60) * 1000 };
    return j.access_token;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vigilancia-dataverse.test.ts`
Expected: passa.

- [ ] **Step 5: Commit**

```bash
git add server/vigilancia/dataverse.ts tests/vigilancia-dataverse.test.ts
git commit -m "feat(vigilância): leitura das OS da janela no Dataverse

Token por client credentials com cache, consulta OData das reservas das
próximas horas (sem canceladas e concluídas), placas pela tabela de
veículos e extração do endereço de embarque da primeira linha.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Infleet (frota inteira)

**Files:**
- Create: `server/vigilancia/infleet.ts`
- Test: `tests/vigilancia-infleet.test.ts`

**Interfaces:**
- Produces: `normalizarPlaca(s: string | null | undefined): string`; `class InfleetCliente { constructor(token: string, fetchFn?); frota(): Promise<Map<string, Posicao>> }` (chave = placa normalizada).

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/vigilancia-infleet.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { InfleetCliente, normalizarPlaca } from "../server/vigilancia/infleet.ts";

const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const veiculo = (plate: string, over: Record<string, unknown> = {}) => ({
  id: plate, plate, displayName: plate, driver: { id: "d", name: "Beto" },
  location: { latitude: -23.6, longitude: -46.7, address: "Rod. Castello Branco", speed: 60, ignition: true, fixTime: "2026-10-14T15:59:00Z" }, ...over,
});

test("normalizarPlaca: sem hífen, espaços e em maiúsculas", () => {
  assert.equal(normalizarPlaca("abc-1d23"), "ABC1D23");
  assert.equal(normalizarPlaca(" ABC 1D23 "), "ABC1D23");
  assert.equal(normalizarPlaca(null), "");
});

test("frota: pagina de 100 em 100 e indexa por placa normalizada", async () => {
  const pedidos: { query: string; variables: Record<string, unknown>; auth: string }[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    pedidos.push({ ...b, auth: (init.headers as Record<string, string>).Authorization });
    const offset = b.variables.offset as number;
    const lista = offset === 0 ? Array.from({ length: 100 }, (_, i) => veiculo(`AAA${String(i).padStart(4, "0")}`)) : [veiculo("ABC-1D23"), veiculo("SEM0000", { location: null })];
    return resposta({ data: { listVehicles: lista } });
  }) as typeof fetch;
  const frota = await new InfleetCliente("tok", f).frota();
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[0].auth, "Bearer tok");
  assert.match(pedidos[0].query, /listVehicles\(limit:100, offset:\$offset/);
  assert.equal(frota.size, 101);
  assert.deepEqual(frota.get("ABC1D23"), { placa: "ABC-1D23", lat: -23.6, lon: -46.7, endereco: "Rod. Castello Branco", velocidadeKmh: 60, ignicao: true, fixAt: Date.UTC(2026, 9, 14, 15, 59), motorista: "Beto" });
  assert.equal(frota.has("SEM0000"), false);
});

test("frota: erro GraphQL vira exceção", async () => {
  const f = (async () => resposta({ errors: [{ message: "unauthorized" }] })) as typeof fetch;
  await assert.rejects(new InfleetCliente("tok", f).frota(), /Infleet HTTP 200/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vigilancia-infleet.test.ts`
Expected: falha com "Cannot find module .../infleet.ts".

- [ ] **Step 3: Implementar**

```ts
// server/vigilancia/infleet.ts
import type { Posicao } from "./tipos.ts";

const ENDPOINT = "https://api.infleet.com.br/v1/graphql";
const CAMPOS = `id plate displayName driver { id name } location { latitude longitude address speed ignition fixTime }`;
const PAGINA = 100;

type Veiculo = {
  plate: string | null;
  driver: { name: string | null } | null;
  location: { latitude: number; longitude: number; address: string | null; speed: number | null; ignition: boolean | null; fixTime: string } | null;
};

export const normalizarPlaca = (s: string | null | undefined): string => (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();

export class InfleetCliente {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Posição atual de toda a frota, indexada pela placa normalizada. Veículos sem posição ficam de fora. */
  async frota(): Promise<Map<string, Posicao>> {
    const frota = new Map<string, Posicao>();
    for (let offset = 0; ; offset += PAGINA) {
      const d = await this.gql<{ listVehicles: Veiculo[] }>(`query($offset:Int){ listVehicles(limit:${PAGINA}, offset:$offset){ ${CAMPOS} } }`, { offset });
      for (const v of d.listVehicles) {
        const l = v.location;
        if (!v.plate || !l) continue;
        frota.set(normalizarPlaca(v.plate), {
          placa: v.plate, lat: l.latitude, lon: l.longitude, endereco: l.address, velocidadeKmh: l.speed ?? 0, ignicao: !!l.ignition, fixAt: new Date(l.fixTime).getTime(), motorista: v.driver?.name ?? null,
        });
      }
      if (d.listVehicles.length < PAGINA) return frota;
    }
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` }, body: JSON.stringify({ query, variables }) });
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
    if (!res.ok || body.errors || !body.data) throw new Error(`Infleet HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    return body.data;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vigilancia-infleet.test.ts`
Expected: passa.

- [ ] **Step 5: Commit**

```bash
git add server/vigilancia/infleet.ts tests/vigilancia-infleet.test.ts
git commit -m "feat(vigilância): posição da frota inteira pela GraphQL da Infleet

Uma consulta paginada por ciclo, indexada por placa normalizada; veículos
sem posição ficam de fora.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Mensagem (template e API Anthropic)

**Files:**
- Create: `server/vigilancia/mensagem.ts`
- Test: `tests/vigilancia-mensagem.test.ts`

**Interfaces:**
- Consumes: `Avaliacao` (Task 1), `TokenUsage` de `server/pricing.ts`.
- Produces: `templateReserva(av: Avaliacao): string`; `hora(ms: number): string`; `class Redator { constructor(apiKey: () => string | null | undefined, api?: (key) => Pick<Anthropic, "beta">, timeoutMs?: number); redigir(av: Avaliacao): Promise<Redacao> }` com `type Redacao = { texto: string; usage: TokenUsage | null; reserva: boolean; erro: string | null }`.

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/vigilancia-mensagem.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Redator, SISTEMA, templateReserva } from "../server/vigilancia/mensagem.ts";
import type { Avaliacao } from "../server/vigilancia/tipos.ts";

const AGORA = Date.UTC(2026, 9, 14, 16, 0); // 13:00 SP
const MIN = 60_000;
const av = (over: Partial<Avaliacao> = {}, fatos: Partial<Avaliacao["fatos"]> = {}): Avaliacao => ({
  osId: "os-1", nivel: "atraso",
  fatos: { os: "OS-1234", cliente: "Acme", passageiros: "Fulano", motorista: "Beto", placa: "ABC1D23", embarque: "Av. Paulista, 1000", saidaAt: AGORA + 40 * MIN, faltamMin: 40, posicao: { endereco: "Rod. Castello Branco km 20", minutosSemAtualizar: 1, velocidadeKmh: 60 }, distanciaKm: 30, trajetoMin: 52, chegadaAt: AGORA + 52 * MIN, folgaMin: -12, semTransito: false, paradoHaMin: null, ...fatos },
  ...over,
});

test("templateReserva: atraso com todos os fatos, em formato WhatsApp", () => {
  const t = templateReserva(av());
  assert.equal(t.split("\n")[0], "*⚠️ Risco de atraso — OS-1234*");
  assert.match(t, /• Cliente: Acme · Passageiro: Fulano/);
  assert.match(t, /• Motorista: Beto · Placa ABC1D23/);
  assert.match(t, /• Embarque 13:40 em Av\. Paulista, 1000/);
  assert.match(t, /• Carro em Rod\. Castello Branco km 20, previsão 13:52 \(12 min de atraso, com trânsito\)/);
});

test("templateReserva: títulos por nível e normalização", () => {
  assert.match(templateReserva(av({ nivel: "atencao" }, { folgaMin: 5, trajetoMin: 35, chegadaAt: AGORA + 35 * MIN })), /^\*🕒 Atenção — OS-1234\*/);
  assert.match(templateReserva(av({ nivel: "atencao" }, { folgaMin: 5, trajetoMin: 35, chegadaAt: AGORA + 35 * MIN, semTransito: true })), /previsão 13:35 \(5 min de folga, sem trânsito\)/);
  assert.match(templateReserva(av({ nivel: "sem_sinal" }, { posicao: { endereco: "Rod. X", minutosSemAtualizar: 15, velocidadeKmh: 0 }, trajetoMin: null, chegadaAt: null, folgaMin: null })), /^\*📵 Sem sinal — OS-1234\*[\s\S]*sem atualizar há 15 min/);
  assert.match(templateReserva(av({ nivel: "parado" }, { paradoHaMin: 12, trajetoMin: null, chegadaAt: null, folgaMin: null })), /^\*🛑 Carro parado — OS-1234\*[\s\S]*parado há 12 min a 30 km do embarque/);
  assert.match(templateReserva(av({ nivel: "sem_programacao" }, { motorista: null, placa: null, posicao: null, distanciaKm: null, trajetoMin: null, chegadaAt: null, folgaMin: null })), /^\*❗ Sem programação — OS-1234\*[\s\S]*• Motorista: — · Placa —/);
  assert.match(templateReserva(av({ nivel: "ok" }, { folgaMin: 15, trajetoMin: 25, chegadaAt: AGORA + 25 * MIN })), /^\*✅ Normalizou — OS-1234\*/);
});

test("Redator: chama a API com o prompt fixo em cache, effort low e devolve o texto", async () => {
  let pedido: any = null;
  const api = () => ({ beta: { messages: { create: async (body: any) => (pedido = body, { stop_reason: "end_turn", content: [{ type: "text", text: "  *⚠️ Risco de atraso — OS-1234*\n• texto do modelo  " }], usage: { input_tokens: 500, output_tokens: 40, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } }) } } }) as any;
  const r = new Redator(() => "sk-teste", api);
  const out = await r.redigir(av());
  assert.equal(out.texto, "*⚠️ Risco de atraso — OS-1234*\n• texto do modelo");
  assert.equal(out.reserva, false);
  assert.deepEqual(out.usage, { inputTokens: 800, outputTokens: 40, cachedTokens: 300 });
  assert.equal(pedido.model, "claude-opus-5-5");
  assert.equal(pedido.max_tokens, 1024);
  assert.deepEqual(pedido.output_config, { effort: "low" });
  assert.deepEqual(pedido.cache_control, { type: "ephemeral" });
  assert.equal(pedido.system, SISTEMA);
  assert.deepEqual(pedido.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(pedido.fallbacks, "default");
  assert.match(pedido.messages[0].content, /"os": "OS-1234"/);
  assert.match(pedido.messages[0].content, /"nivel": "atraso"/);
});

test("Redator: sem chave, erro da API, recusa ou resposta vazia caem no template", async () => {
  const semChave = await new Redator(() => null, () => ({}) as any).redigir(av());
  assert.equal(semChave.reserva, true);
  assert.match(semChave.texto, /^\*⚠️ Risco de atraso — OS-1234\*/);
  assert.match(semChave.erro ?? "", /chave/i);
  const falha = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => { throw new Error("boom"); } } } }) as any).redigir(av());
  assert.equal(falha.reserva, true);
  assert.equal(falha.erro, "boom");
  const recusa = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } }) } } }) as any).redigir(av());
  assert.equal(recusa.reserva, true);
  const vazio = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "   " }], usage: { input_tokens: 1, output_tokens: 0 } }) } } }) as any).redigir(av());
  assert.equal(vazio.reserva, true);
});

test("Redator: resposta longa demais (mais de 12 linhas) cai no template", async () => {
  const longa = Array.from({ length: 13 }, (_, i) => `linha ${i}`).join("\n");
  const r = await new Redator(() => "k", () => ({ beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: longa }], usage: { input_tokens: 1, output_tokens: 1 } }) } } }) as any).redigir(av());
  assert.equal(r.reserva, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vigilancia-mensagem.test.ts`
Expected: falha com "Cannot find module .../mensagem.ts".

- [ ] **Step 3: Implementar**

```ts
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
  constructor(
    private readonly apiKey: () => string | null | undefined,
    private readonly api: (key: string) => Pick<Anthropic, "beta"> = (key) => new Anthropic({ apiKey: key, maxRetries: 1 }),
    private readonly timeoutMs = 20_000,
  ) {}

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
```

Se `pnpm typecheck` reclamar do tipo do pedido (`fallbacks`/`betas` na versão 0.133 do SDK), use exatamente a mesma forma de `server/claude.ts` `completeApi`, que já compila nesse SDK.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vigilancia-mensagem.test.ts`
Expected: passa.

- [ ] **Step 5: Commit**

```bash
git add server/vigilancia/mensagem.ts tests/vigilancia-mensagem.test.ts
git commit -m "feat(vigilância): redação do aviso pela API da Anthropic com template de reserva

Prompt fixo em cache, claude-opus-5-5 com effort baixo e fallback no
servidor; sem chave, erro, recusa ou resposta inválida usa o template com
os mesmos fatos.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Job (ciclo, agendador, falhas por fonte)

**Files:**
- Create: `server/vigilancia/job.ts`
- Test: `tests/vigilancia-job.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–6.
- Produces:

```ts
type ConfigVigilancia = { grupoJid: string; janelaMin: number; cadenciaMin: number; ensaio: boolean; regras: ConfigRegras };
type DepsVigilancia = { dataverse: { osNaJanela(agora, janelaMin): Promise<OsVigiada[]> }; infleet: { frota(): Promise<Map<string, Posicao>> }; geocodificador: { localizar(e): Promise<Coord | null> }; roteador: { rota(o, d): Promise<Rota | null> }; redator: { redigir(av): Promise<Redacao> }; estado: Pick<Store, "vigilanciaNivel" | "vigilanciaRegistrar" | "vigilanciaLimpar">; enviar: (jid, texto) => Promise<string | null>; registrarUso?: (usage: TokenUsage | null, ok: boolean) => void; log: (msg: string) => void; agora?: () => number };
type ResultadoCiclo = { em: number; avaliadas: { osId; os; nivel; anterior; folgaMin }[]; enviadas: { osId; nivel; texto; reserva }[]; erros: string[]; ensaio: boolean };
class Vigilancia { constructor(deps, config); ciclo(): Promise<ResultadoCiclo>; iniciar(): void; parar(): void; ultimo(): ResultadoCiclo | null; emExecucao(): boolean }
```

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/vigilancia-job.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { Vigilancia, type ConfigVigilancia, type DepsVigilancia } from "../server/vigilancia/job.ts";
import { CONFIG_REGRAS_PADRAO, type OsVigiada, type Posicao, type Rota } from "../server/vigilancia/tipos.ts";

const AGORA = Date.UTC(2026, 9, 14, 16, 0);
const MIN = 60_000;
const CFG: ConfigVigilancia = { grupoJid: "grupo@g.us", janelaMin: 120, cadenciaMin: 5, ensaio: false, regras: CONFIG_REGRAS_PADRAO };
const os = (over: Partial<OsVigiada> = {}): OsVigiada => ({ id: "os-1", numero: "OS-1", saidaAt: AGORA + 40 * MIN, endereco: "Av. Paulista, 1000", cliente: "Acme", passageiros: "Fulano", motorista: "Beto", placa: "ABC-1D23", ...over });
const pos = (over: Partial<Posicao> = {}): Posicao => ({ placa: "ABC-1D23", lat: -23.6, lon: -46.7, endereco: "Castello", velocidadeKmh: 60, ignicao: true, fixAt: AGORA - MIN, motorista: "Beto", ...over });

function montar(over: Partial<DepsVigilancia> & { rota?: Rota | null; lista?: OsVigiada[]; frota?: Map<string, Posicao> } = {}) {
  const store = new Store(":memory:");
  const enviados: { jid: string; texto: string }[] = [];
  const usos: boolean[] = [];
  const logs: string[] = [];
  let agora = AGORA;
  const deps: DepsVigilancia = {
    dataverse: { osNaJanela: async () => over.lista ?? [os()] },
    infleet: { frota: async () => over.frota ?? new Map([["ABC1D23", pos()]]) },
    geocodificador: { localizar: async () => ({ lat: -23.5614, lon: -46.6559 }) },
    roteador: { rota: async () => (over.rota === undefined ? { minutos: 20, km: 15, semTransito: false } : over.rota) },
    redator: { redigir: async (av) => ({ texto: `aviso ${av.nivel} ${av.fatos.os}`, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, reserva: false, erro: null }) },
    estado: store,
    enviar: async (jid, texto) => (enviados.push({ jid, texto }), "id-1"),
    registrarUso: (_u, ok) => void usos.push(ok),
    log: (m) => void logs.push(m),
    agora: () => agora,
    ...over,
  };
  return { deps, store, enviados, usos, logs, avancar: (ms: number) => (agora += ms) };
}

test("ciclo: OS ok não envia nada nem grava estado", async () => {
  const m = montar();
  const r = await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(r.avaliadas.length, 1);
  assert.equal(r.avaliadas[0].nivel, "ok");
  assert.equal(r.enviadas.length, 0);
  assert.equal(m.enviados.length, 0);
  assert.equal(m.store.vigilanciaNivel("os-1"), null);
});

test("ciclo: entra em atraso → envia uma vez e grava; repete o nível → não reenvia; volta a ok → avisa normalizou", async () => {
  const m = montar({ rota: { minutos: 55, km: 40, semTransito: false } });
  const v = new Vigilancia(m.deps, CFG);
  await v.ciclo();
  assert.deepEqual(m.enviados, [{ jid: "grupo@g.us", texto: "aviso atraso OS-1" }]);
  assert.equal(m.store.vigilanciaNivel("os-1"), "atraso");
  assert.deepEqual(m.usos, [true]);
  await v.ciclo();
  assert.equal(m.enviados.length, 1);
  m.deps.roteador = { rota: async () => ({ minutos: 10, km: 5, semTransito: false }) };
  await v.ciclo();
  assert.equal(m.enviados.length, 2);
  assert.equal(m.enviados[1].texto, "aviso ok OS-1");
  assert.equal(m.store.vigilanciaNivel("os-1"), "ok");
});

test("ciclo: envio que não devolve id (WhatsApp fora) não grava o estado e tenta de novo", async () => {
  const m = montar({ rota: { minutos: 55, km: 40, semTransito: false }, enviar: async () => null });
  const v = new Vigilancia(m.deps, CFG);
  const r = await v.ciclo();
  assert.equal(r.enviadas.length, 0);
  assert.match(r.erros.join(" "), /WhatsApp/);
  assert.equal(m.store.vigilanciaNivel("os-1"), null);
});

test("ciclo: modo ensaio usa o template, não chama a API, não envia e não grava", async () => {
  let redigiu = false;
  const m = montar({ rota: { minutos: 55, km: 40, semTransito: false }, redator: { redigir: async () => (redigiu = true, { texto: "x", usage: null, reserva: false, erro: null }) } });
  const r = await new Vigilancia(m.deps, { ...CFG, ensaio: true }).ciclo();
  assert.equal(r.ensaio, true);
  assert.equal(r.enviadas.length, 1);
  assert.match(r.enviadas[0].texto, /^\*⚠️ Risco de atraso — OS-1\*/);
  assert.equal(redigiu, false);
  assert.equal(m.enviados.length, 0);
  assert.equal(m.store.vigilanciaNivel("os-1"), null);
});

test("ciclo: só pede rota a menos de 60 min do embarque", async () => {
  let rotas = 0;
  const m = montar({ lista: [os({ saidaAt: AGORA + 90 * MIN })], roteador: { rota: async () => (rotas++, null) } });
  await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(rotas, 0);
  m.deps.dataverse = { osNaJanela: async () => [os({ saidaAt: AGORA + 50 * MIN })] };
  await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(rotas, 1);
});

test("ciclo: carro parado é detectado com a memória entre ciclos", async () => {
  const m = montar({ lista: [os({ saidaAt: AGORA + 25 * MIN })], frota: new Map([["ABC1D23", pos({ velocidadeKmh: 0, ignicao: false, fixAt: AGORA - 15 * MIN })]]), rota: null });
  const v = new Vigilancia(m.deps, CFG);
  const r1 = await v.ciclo();
  assert.equal(r1.avaliadas[0].nivel, "parado");
  assert.equal(m.enviados.length, 1);
});

test("ciclo: Dataverse fora pula o ciclo; na 3ª falha seguida avisa o grupo uma vez por hora e avisa quando volta", async () => {
  const m = montar({ dataverse: { osNaJanela: async () => { throw new Error("HTTP 500"); } } });
  const v = new Vigilancia(m.deps, CFG);
  await v.ciclo();
  await v.ciclo();
  assert.equal(m.enviados.length, 0);
  const r = await v.ciclo();
  assert.match(r.erros[0], /Dataverse/);
  assert.equal(m.enviados.length, 1);
  assert.match(m.enviados[0].texto, /vigilância sem dados/i);
  await v.ciclo();
  assert.equal(m.enviados.length, 1);
  m.avancar(61 * MIN);
  await v.ciclo();
  assert.equal(m.enviados.length, 2);
  m.deps.dataverse = { osNaJanela: async () => [] };
  await v.ciclo();
  assert.equal(m.enviados.length, 3);
  assert.match(m.enviados[2].texto, /vigilância normalizada/i);
});

test("ciclo: rota indisponível só gera aviso de fonte depois de 3 ciclos e a OS é avaliada sem rota", async () => {
  const m = montar({ lista: [os({ saidaAt: AGORA + 30 * MIN })], rota: null });
  const v = new Vigilancia(m.deps, CFG);
  const r = await v.ciclo();
  assert.equal(r.avaliadas[0].nivel, "ok");
  assert.equal(r.avaliadas[0].folgaMin, null);
  await v.ciclo();
  await v.ciclo();
  assert.equal(m.enviados.length, 1);
  assert.match(m.enviados[0].texto, /rota/i);
});

test("ciclo: estado de OS cuja saída passou há mais de 30 min é apagado", async () => {
  const m = montar();
  m.store.vigilanciaRegistrar("velha", "atraso", AGORA - 31 * MIN, AGORA - 60 * MIN);
  m.store.vigilanciaRegistrar("recente", "atraso", AGORA - 10 * MIN, AGORA - 20 * MIN);
  await new Vigilancia(m.deps, CFG).ciclo();
  assert.equal(m.store.vigilanciaNivel("velha"), null);
  assert.equal(m.store.vigilanciaNivel("recente"), "atraso");
});

test("iniciar/parar: ciclos não se sobrepõem e parar cancela o timer", async () => {
  let ativos = 0, max = 0;
  const m = montar({ dataverse: { osNaJanela: async () => { ativos++; max = Math.max(max, ativos); await new Promise((r) => setTimeout(r, 20)); ativos--; return []; } } });
  const v = new Vigilancia(m.deps, { ...CFG, cadenciaMin: 0.0002 }); // ~12 ms
  v.iniciar();
  await new Promise((r) => setTimeout(r, 80));
  v.parar();
  assert.equal(max, 1);
  assert.ok(v.ultimo());
  const n = v.ultimo()!.em;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(v.ultimo()!.em, n);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vigilancia-job.test.ts`
Expected: falha com "Cannot find module .../job.ts".

- [ ] **Step 3: Implementar**

```ts
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

  constructor(
    private readonly deps: DepsVigilancia,
    private readonly config: ConfigVigilancia,
  ) {
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vigilancia-job.test.ts`
Expected: passa. Se o teste de "parado" falhar, confira que `marcarParada` recebe `fixAt` antigo no primeiro ciclo (a parada começa no `fixAt` da posição, não no `agora`).

- [ ] **Step 5: Commit**

```bash
git add server/vigilancia/job.ts tests/vigilancia-job.test.ts
git commit -m "feat(vigilância): ciclo de vigilância com agendador e avisos por fonte

Cruza OS, frota e rota, avalia pelas regras, envia só em mudança de nível,
grava o estado apenas após envio confirmado, modo ensaio sem envio e
aviso ao grupo após 3 ciclos seguidos sem dados de uma fonte.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Configuração, montagem e rotas HTTP

**Files:**
- Create: `server/vigilancia/index.ts`
- Modify: `server/app.ts` (após o bloco de lembretes, no objeto retornado e em `close`)
- Modify: `server/http.ts` (tipo `Api`, `settingsSchema`, rotas)
- Modify: `tests/fake-api.ts`
- Test: `tests/vigilancia-config.test.ts`

**Interfaces:**
- Produces em `index.ts`:

```ts
type StatusVigilancia = { ativa: boolean; emExecucao: boolean; faltando: string[]; grupoJid: string | null; grupos: { jid: string; name: string }[]; margemMin: number; janelaMin: number; cadenciaMin: number; ensaio: boolean; segredos: { anthropic: boolean; dataverse: boolean; infleet: boolean; tomtom: boolean }; ultimo: ResultadoCiclo | null };
type PatchVigilancia = { ativa?: boolean; grupoJid?: string | null; margemMin?: number; janelaMin?: number; cadenciaMin?: number; ensaio?: boolean; dvEnvironmentUrl?: string | null; dvTenantId?: string | null; dvClientId?: string | null; dvClientSecret?: string | null; infleetToken?: string | null; tomtomKey?: string | null };
function lerConfig(get: (k: string) => string | null, env: NodeJS.ProcessEnv): { config: ConfigVigilancia | null; faltando: string[]; dataverse: DataverseConfig | null; infleetToken: string | null; tomtomKey: string | null; ativa: boolean; valores: { grupoJid; margemMin; janelaMin; cadenciaMin; ensaio } }
function aplicarPatch(set: (k: string, v: string | null) => void, patch: PatchVigilancia): void
function criarVigilancia(args: { store: Store; env: NodeJS.ProcessEnv; anthropicKey: () => string | null | undefined; enviar: DepsVigilancia["enviar"]; registrarUso: DepsVigilancia["registrarUso"]; log: DepsVigilancia["log"] }): Vigilancia | null
```

- Em `Api` (http.ts): `vigilanciaStatus: () => StatusVigilancia; vigilanciaSalvar: (patch: PatchVigilancia) => StatusVigilancia; vigilanciaCiclo: () => Promise<ResultadoCiclo>`.
- Rotas: `GET /api/vigilancia`, `PUT /api/vigilancia`, `POST /api/vigilancia/ciclo`.

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/vigilancia-config.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../server/db.ts";
import { aplicarPatch, lerConfig } from "../server/vigilancia/index.ts";

const TODOS = { vigilancia_grupo_jid: "g@g.us", dv_environment_url: "https://org.crm2.dynamics.com/", dv_tenant_id: "t", dv_client_id: "c", dv_client_secret: "s", infleet_token: "i" };

test("lerConfig: lista o que falta e usa padrões", () => {
  const s = new Store(":memory:");
  const c = lerConfig((k) => s.getSetting(k), {});
  assert.equal(c.config, null);
  assert.deepEqual(c.faltando, ["Grupo do WhatsApp", "URL do Dataverse", "Tenant ID", "Client ID", "Client Secret", "Token da Infleet"]);
  assert.deepEqual(c.valores, { grupoJid: null, margemMin: 10, janelaMin: 120, cadenciaMin: 5, ensaio: false });
});

test("lerConfig: completa pelas settings, aceita env como alternativa e tira a barra final da URL", () => {
  const s = new Store(":memory:");
  for (const [k, v] of Object.entries(TODOS)) s.setSetting(k, v);
  s.setSetting("vigilancia_margem_min", "15");
  s.setSetting("vigilancia_ativa", "1");
  const c = lerConfig((k) => s.getSetting(k), {});
  assert.deepEqual(c.faltando, []);
  assert.equal(c.ativa, true);
  assert.equal(c.config?.regras.margemMin, 15);
  assert.equal(c.config?.grupoJid, "g@g.us");
  assert.equal(c.dataverse?.url, "https://org.crm2.dynamics.com");
  assert.equal(c.tomtomKey, null);
  const env = lerConfig((k) => (k === "vigilancia_grupo_jid" ? "g@g.us" : null), { DV_ENVIRONMENT_URL: "https://x.crm.dynamics.com", DV_TENANT_ID: "t", DV_CLIENT_ID: "c", DV_CLIENT_SECRET: "s", INFLEET_TOKEN: "i", TOMTOM_KEY: "tt" });
  assert.deepEqual(env.faltando, []);
  assert.equal(env.tomtomKey, "tt");
});

test("aplicarPatch: grava só o que veio e apaga com null", () => {
  const s = new Store(":memory:");
  aplicarPatch((k, v) => s.setSetting(k, v), { ativa: true, grupoJid: "g@g.us", margemMin: 12, dvClientSecret: "segredo", tomtomKey: null });
  assert.equal(s.getSetting("vigilancia_ativa"), "1");
  assert.equal(s.getSetting("vigilancia_grupo_jid"), "g@g.us");
  assert.equal(s.getSetting("vigilancia_margem_min"), "12");
  assert.equal(s.getSetting("dv_client_secret"), "segredo");
  assert.equal(s.getSetting("tomtom_key"), null);
  assert.equal(s.getSetting("vigilancia_janela_min"), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vigilancia-config.test.ts`
Expected: falha com "Cannot find module .../index.ts".

- [ ] **Step 3: Implementar `server/vigilancia/index.ts`**

```ts
// server/vigilancia/index.ts
import type { Store } from "../db.ts";
import { DataverseCliente, type DataverseConfig } from "./dataverse.ts";
import { Geocodificador, Roteador } from "./geo.ts";
import { InfleetCliente } from "./infleet.ts";
import { Vigilancia, type ConfigVigilancia, type DepsVigilancia, type ResultadoCiclo } from "./job.ts";
import { Redator } from "./mensagem.ts";
import { CONFIG_REGRAS_PADRAO } from "./tipos.ts";

export type { ResultadoCiclo } from "./job.ts";

export type StatusVigilancia = {
  ativa: boolean;
  emExecucao: boolean;
  faltando: string[];
  grupoJid: string | null;
  grupos: { jid: string; name: string }[];
  margemMin: number;
  janelaMin: number;
  cadenciaMin: number;
  ensaio: boolean;
  segredos: { anthropic: boolean; dataverse: boolean; infleet: boolean; tomtom: boolean };
  ultimo: ResultadoCiclo | null;
};

export type PatchVigilancia = {
  ativa?: boolean;
  grupoJid?: string | null;
  margemMin?: number;
  janelaMin?: number;
  cadenciaMin?: number;
  ensaio?: boolean;
  dvEnvironmentUrl?: string | null;
  dvTenantId?: string | null;
  dvClientId?: string | null;
  dvClientSecret?: string | null;
  infleetToken?: string | null;
  tomtomKey?: string | null;
};

const PADRAO = { margemMin: 10, janelaMin: 120, cadenciaMin: 5 };
const numero = (v: string | null, padrao: number) => (v !== null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : padrao);

export function lerConfig(get: (k: string) => string | null, env: NodeJS.ProcessEnv) {
  const ou = (chave: string, envNome: string) => env[envNome] || get(chave) || null;
  const grupoJid = get("vigilancia_grupo_jid");
  const url = (ou("dv_environment_url", "DV_ENVIRONMENT_URL") ?? "").replace(/\/+$/, "") || null;
  const tenantId = ou("dv_tenant_id", "DV_TENANT_ID");
  const clientId = ou("dv_client_id", "DV_CLIENT_ID");
  const clientSecret = ou("dv_client_secret", "DV_CLIENT_SECRET");
  const infleetToken = ou("infleet_token", "INFLEET_TOKEN");
  const tomtomKey = ou("tomtom_key", "TOMTOM_KEY");
  const faltando = [
    [!grupoJid, "Grupo do WhatsApp"], [!url, "URL do Dataverse"], [!tenantId, "Tenant ID"], [!clientId, "Client ID"], [!clientSecret, "Client Secret"], [!infleetToken, "Token da Infleet"],
  ].filter(([falta]) => falta).map(([, nome]) => nome as string);
  const valores = {
    grupoJid,
    margemMin: numero(get("vigilancia_margem_min"), PADRAO.margemMin),
    janelaMin: numero(get("vigilancia_janela_min"), PADRAO.janelaMin),
    cadenciaMin: numero(get("vigilancia_cadencia_min"), PADRAO.cadenciaMin),
    ensaio: get("vigilancia_ensaio") === "1",
  };
  const completo = faltando.length === 0;
  const config: ConfigVigilancia | null = completo
    ? { grupoJid: grupoJid!, janelaMin: valores.janelaMin, cadenciaMin: valores.cadenciaMin, ensaio: valores.ensaio, regras: { ...CONFIG_REGRAS_PADRAO, margemMin: valores.margemMin } }
    : null;
  const dataverse: DataverseConfig | null = url && tenantId && clientId && clientSecret ? { url, tenantId, clientId, clientSecret } : null;
  return { config, faltando, dataverse, infleetToken, tomtomKey, ativa: get("vigilancia_ativa") === "1", valores };
}

export function aplicarPatch(set: (k: string, v: string | null) => void, p: PatchVigilancia): void {
  const bool = (v: boolean) => (v ? "1" : "0");
  if (p.ativa !== undefined) set("vigilancia_ativa", bool(p.ativa));
  if (p.grupoJid !== undefined) set("vigilancia_grupo_jid", p.grupoJid);
  if (p.margemMin !== undefined) set("vigilancia_margem_min", String(p.margemMin));
  if (p.janelaMin !== undefined) set("vigilancia_janela_min", String(p.janelaMin));
  if (p.cadenciaMin !== undefined) set("vigilancia_cadencia_min", String(p.cadenciaMin));
  if (p.ensaio !== undefined) set("vigilancia_ensaio", bool(p.ensaio));
  if (p.dvEnvironmentUrl !== undefined) set("dv_environment_url", p.dvEnvironmentUrl);
  if (p.dvTenantId !== undefined) set("dv_tenant_id", p.dvTenantId);
  if (p.dvClientId !== undefined) set("dv_client_id", p.dvClientId);
  if (p.dvClientSecret !== undefined) set("dv_client_secret", p.dvClientSecret);
  if (p.infleetToken !== undefined) set("infleet_token", p.infleetToken);
  if (p.tomtomKey !== undefined) set("tomtom_key", p.tomtomKey);
}

/** Monta o job com as dependências reais; null quando falta configuração. */
export function criarVigilancia(args: {
  store: Store;
  env: NodeJS.ProcessEnv;
  anthropicKey: () => string | null | undefined;
  enviar: DepsVigilancia["enviar"];
  registrarUso: DepsVigilancia["registrarUso"];
  log: DepsVigilancia["log"];
}): Vigilancia | null {
  const c = lerConfig((k) => args.store.getSetting(k), args.env);
  if (!c.config || !c.dataverse || !c.infleetToken) return null;
  return new Vigilancia(
    {
      dataverse: new DataverseCliente(c.dataverse),
      infleet: new InfleetCliente(c.infleetToken),
      geocodificador: new Geocodificador(args.store),
      roteador: new Roteador(c.tomtomKey),
      redator: new Redator(args.anthropicKey),
      estado: args.store,
      enviar: args.enviar,
      registrarUso: args.registrarUso,
      log: args.log,
    },
    c.config,
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vigilancia-config.test.ts`
Expected: passa.

- [ ] **Step 5: Ligar em `server/app.ts`**

Imports no topo (junto dos outros `./`):

```ts
import { aplicarPatch, criarVigilancia, lerConfig, type PatchVigilancia, type StatusVigilancia } from "./vigilancia/index.ts";
import { MODELO as MODELO_VIGILANCIA } from "./vigilancia/mensagem.ts";
import type { Vigilancia } from "./vigilancia/job.ts";
```

Depois do bloco de gastos com IA (a função `recordUsage` precisa existir antes), acrescentar:

```ts
  // ---- vigilância da operação: a cada N min cruza OS, frota e rota e avisa o grupo só em risco

  let vigilancia: Vigilancia | null = null;
  const enviarVigilancia = async (jid: string, texto: string): Promise<string | null> => {
    if (!wa || wa.state.status !== "conectado") return null;
    return wa.send(jid, texto);
  };
  function montarVigilancia() {
    vigilancia?.parar();
    vigilancia = criarVigilancia({
      store,
      env: process.env,
      anthropicKey,
      enviar: enviarVigilancia,
      registrarUso: (usage, ok) => recordUsage("claude", "vigilancia", store.getSetting("vigilancia_grupo_jid"), usage, { model: MODELO_VIGILANCIA }),
      log: (m) => console.warn(m),
    });
    if (vigilancia && store.getSetting("vigilancia_ativa") === "1") vigilancia.iniciar();
  }
  const vigilanciaStatus = (): StatusVigilancia => {
    const c = lerConfig((k) => store.getSetting(k), process.env);
    return {
      ativa: c.ativa,
      emExecucao: !!vigilancia?.emExecucao(),
      faltando: c.faltando,
      grupoJid: c.valores.grupoJid,
      grupos: store.listChats().filter((ch) => ch.isGroup).map((ch) => ({ jid: ch.jid, name: ch.name })),
      margemMin: c.valores.margemMin,
      janelaMin: c.valores.janelaMin,
      cadenciaMin: c.valores.cadenciaMin,
      ensaio: c.valores.ensaio,
      segredos: { anthropic: !!anthropicKey(), dataverse: !!c.dataverse, infleet: !!c.infleetToken, tomtom: !!c.tomtomKey },
      ultimo: vigilancia?.ultimo() ?? null,
    };
  };
  function vigilanciaSalvar(patch: PatchVigilancia): StatusVigilancia {
    aplicarPatch((k, v) => store.setSetting(k, v), patch);
    montarVigilancia();
    return vigilanciaStatus();
  }
  async function vigilanciaCiclo() {
    if (!vigilancia) throw new Error(`Vigilância sem configuração: ${lerConfig((k) => store.getSetting(k), process.env).faltando.join(", ")}.`);
    return vigilancia.ciclo();
  }
  montarVigilancia();
```

Atenção ao `recordUsage`: a assinatura exige `model` como alias de Claude quando o backend é `api`; aqui o modelo é fixo. Se `claudeUsageModel` transformar `"claude-opus-5-5"` em algo errado, grave direto com `store.recordAiUsage({ at: Date.now(), provider: "claude", kind: "vigilancia", chatJid: ..., model: MODELO_VIGILANCIA, usage: usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, costUsd: usage ? estimateCostUsd("claude", usage, new Date(), MODELO_VIGILANCIA) : 0, label: null, confidence: null, needsReply: null, urgent: null, ok })` (importando `estimateCostUsd` de `./pricing.ts`). Confira com `rg -n "function recordUsage" -A12 server/app.ts` qual dos dois caminhos é correto e use só um.

No objeto que `startApp` devolve para `createHandler` (o `Api`; procure `createHandler({` em `server/app.ts`), acrescentar:

```ts
    vigilanciaStatus,
    vigilanciaSalvar,
    vigilanciaCiclo,
```

Em `close`, antes de `await wa?.stop()`:

```ts
      vigilancia?.parar();
```

- [ ] **Step 6: Rotas em `server/http.ts`**

No tipo `Api`:

```ts
  vigilanciaStatus: () => StatusVigilancia;
  vigilanciaSalvar: (patch: PatchVigilancia) => StatusVigilancia;
  vigilanciaCiclo: () => Promise<ResultadoCiclo>;
```

com o import `import type { PatchVigilancia, ResultadoCiclo, StatusVigilancia } from "./vigilancia/index.ts";`.

Schema (ao lado de `settingsSchema`):

```ts
const segredo = z.string().trim().min(3).max(500).nullable().optional();
const vigilanciaSchema = z.object({
  ativa: z.boolean().optional(),
  grupoJid: z.string().trim().regex(/@g\.us$/, "Escolha um grupo.").nullable().optional(),
  margemMin: z.number().int().min(1).max(120).optional(),
  janelaMin: z.number().int().min(30).max(360).optional(),
  cadenciaMin: z.number().int().min(1).max(30).optional(),
  ensaio: z.boolean().optional(),
  dvEnvironmentUrl: z.string().trim().url().nullable().optional(),
  dvTenantId: segredo,
  dvClientId: segredo,
  dvClientSecret: segredo,
  infleetToken: segredo,
  tomtomKey: segredo,
});
```

Rotas, logo após a de `/api/settings`:

```ts
    if (path === "/api/vigilancia" && method === "GET") return json(res, 200, api.vigilanciaStatus());
    if (path === "/api/vigilancia" && method === "PUT") return json(res, 200, api.vigilanciaSalvar(parse(vigilanciaSchema, await readJson(req))));
    if (path === "/api/vigilancia/ciclo" && method === "POST") return json(res, 200, await api.vigilanciaCiclo());
```

Em `tests/fake-api.ts`, acrescentar ao objeto:

```ts
    vigilanciaStatus: () => ({ ativa: false, emExecucao: false, faltando: [], grupoJid: null, grupos: [], margemMin: 10, janelaMin: 120, cadenciaMin: 5, ensaio: false, segredos: { anthropic: false, dataverse: false, infleet: false, tomtom: false }, ultimo: null }),
    vigilanciaSalvar: () => ({ ativa: false, emExecucao: false, faltando: [], grupoJid: null, grupos: [], margemMin: 10, janelaMin: 120, cadenciaMin: 5, ensaio: false, segredos: { anthropic: false, dataverse: false, infleet: false, tomtom: false }, ultimo: null }),
    vigilanciaCiclo: async () => ({ em: 0, avaliadas: [], enviadas: [], erros: [], ensaio: true }),
```

- [ ] **Step 7: Typecheck e suíte inteira**

Run: `pnpm typecheck && pnpm test`
Expected: sem erros de tipo; todos os testes passam (os antigos continuam verdes).

- [ ] **Step 8: Commit**

```bash
git add server/vigilancia/index.ts server/app.ts server/http.ts tests/fake-api.ts tests/vigilancia-config.test.ts
git commit -m "feat(vigilância): configuração, montagem no app e rotas HTTP

Leitura das settings e variáveis de ambiente com lista do que falta,
patch de configuração, montagem do job com as dependências reais,
início automático quando ativa e rotas GET/PUT /api/vigilancia e
POST /api/vigilancia/ciclo.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Aba "Vigilância" nas Configurações

**Files:**
- Modify: `ui/api.ts` (tipos e chamadas)
- Create: `ui/vigilancia.tsx`
- Modify: `ui/settings.tsx` (lista de abas, import, render)

**Interfaces:**
- Consumes: `GET/PUT /api/vigilancia`, `POST /api/vigilancia/ciclo` (Task 8).
- Produces: `api.vigilancia()`, `api.saveVigilancia(patch)`, `api.vigilanciaCiclo()`; componente `VigilanciaPanel({ notify })`.

Não há teste automatizado de UI no projeto; a verificação é manual (Step 4).

- [ ] **Step 1: Tipos e chamadas em `ui/api.ts`**

Acrescentar os tipos (perto de `McpStatus`):

```ts
export type NivelVigilancia = "ok" | "sem_programacao" | "sem_sinal" | "parado" | "atraso" | "atencao";
export type ResultadoCiclo = {
  em: number;
  avaliadas: { osId: string; os: string; nivel: NivelVigilancia; anterior: NivelVigilancia | null; folgaMin: number | null }[];
  enviadas: { osId: string; nivel: NivelVigilancia; texto: string; reserva: boolean }[];
  erros: string[];
  ensaio: boolean;
};
export type VigilanciaStatus = {
  ativa: boolean;
  emExecucao: boolean;
  faltando: string[];
  grupoJid: string | null;
  grupos: { jid: string; name: string }[];
  margemMin: number;
  janelaMin: number;
  cadenciaMin: number;
  ensaio: boolean;
  segredos: { anthropic: boolean; dataverse: boolean; infleet: boolean; tomtom: boolean };
  ultimo: ResultadoCiclo | null;
};
export type VigilanciaPatch = Partial<{
  ativa: boolean; grupoJid: string | null; margemMin: number; janelaMin: number; cadenciaMin: number; ensaio: boolean;
  dvEnvironmentUrl: string | null; dvTenantId: string | null; dvClientId: string | null; dvClientSecret: string | null; infleetToken: string | null; tomtomKey: string | null;
}>;
```

e, no objeto `api`, ao lado de `mcpStatus`:

```ts
  vigilancia: () => request<VigilanciaStatus>("GET", "/api/vigilancia"),
  saveVigilancia: (p: VigilanciaPatch) => request<VigilanciaStatus>("PUT", "/api/vigilancia", p),
  vigilanciaCiclo: () => request<ResultadoCiclo>("POST", "/api/vigilancia/ciclo", {}),
```

- [ ] **Step 2: Criar `ui/vigilancia.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type NivelVigilancia, type ResultadoCiclo, type VigilanciaPatch, type VigilanciaStatus } from "./api.ts";
import { Button, Checkbox, Field, Input, Switch } from "./ds/index.ts";

const NIVEL: Record<NivelVigilancia, string> = { ok: "OK", sem_programacao: "Sem programação", sem_sinal: "Sem sinal", parado: "Carro parado", atraso: "Risco de atraso", atencao: "Atenção" };
const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

type Segredo = { campo: keyof VigilanciaPatch; rotulo: string; salvo: boolean; dica: string };

export function VigilanciaPanel({ notify }: { notify: (kind: "error" | "success", text: string) => void }) {
  const [s, setS] = useState<VigilanciaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [ciclo, setCiclo] = useState<ResultadoCiclo | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api.vigilancia().then((v) => alive && (setS(v), setCiclo(v.ultimo)), (e: Error) => alive && setFalha(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const salvar = async (patch: VigilanciaPatch, ok = "Vigilância atualizada.") => {
    setBusy(true);
    try {
      setS(await api.saveVigilancia(patch));
      notify("success", ok);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rodar = async () => {
    setBusy(true);
    try {
      const r = await api.vigilanciaCiclo();
      setCiclo(r);
      notify("success", r.ensaio ? "Ciclo de ensaio concluído (nada foi enviado)." : "Ciclo concluído.");
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (falha) return <p className="hint hint--warning">Não foi possível consultar a vigilância. {falha}</p>;
  if (!s) return <p className="hint">Consultando…</p>;

  const segredos: Segredo[] = [
    { campo: "dvEnvironmentUrl", rotulo: "URL do Dataverse (PROD)", salvo: s.segredos.dataverse, dica: "Ex.: https://suaorg.crm2.dynamics.com" },
    { campo: "dvTenantId", rotulo: "Tenant ID", salvo: s.segredos.dataverse, dica: "Diretório do Entra ID" },
    { campo: "dvClientId", rotulo: "Client ID", salvo: s.segredos.dataverse, dica: "App registration com application user só de leitura" },
    { campo: "dvClientSecret", rotulo: "Client Secret", salvo: s.segredos.dataverse, dica: "Fica só neste PC" },
    { campo: "infleetToken", rotulo: "Token da Infleet", salvo: s.segredos.infleet, dica: "Mesmo token do infleet-mcp" },
    { campo: "tomtomKey", rotulo: "Chave da TomTom (opcional)", salvo: s.segredos.tomtom, dica: "Rota com trânsito; sem ela usa OSRM, sem trânsito" },
  ];
  const num = (campo: "margemMin" | "janelaMin" | "cadenciaMin", rotulo: string, dica: string) => (
    <Field label={rotulo} hint={dica}>
      <Input type="number" min={1} value={valores[campo] ?? String(s[campo])} onChange={(e) => setValores({ ...valores, [campo]: e.target.value })} onBlur={() => {
        const v = Number(valores[campo]);
        if (Number.isFinite(v) && v > 0 && v !== s[campo]) void salvar({ [campo]: Math.round(v) });
      }} />
    </Field>
  );

  return (
    <div className="stack">
      <p className="hint">
        A cada poucos minutos cruza as OS das próximas horas (Dataverse) com a posição dos carros (Infleet) e o tempo de trajeto com trânsito, e avisa o grupo da operação só quando uma OS entra em risco de atraso ou muda de situação. Roda enquanto o Inbox estiver aberto ou na bandeja.
      </p>
      {s.faltando.length > 0 && <p className="hint hint--warning">Falta configurar: {s.faltando.join(", ")}.</p>}
      {!s.segredos.anthropic && <p className="hint hint--warning">Sem chave da API da Anthropic (aba IA): os avisos saem no formato fixo, sem redação do Claude.</p>}
      <Switch checked={s.ativa} disabled={busy || s.faltando.length > 0} onChange={(e) => void salvar({ ativa: e.target.checked }, e.target.checked ? "Vigilância ligada." : "Vigilância desligada.")} label="Vigilância ligada" />
      <Field label="Grupo do WhatsApp" hint="Grupo interno da operação que recebe os avisos.">
        <select className="input" value={s.grupoJid ?? ""} disabled={busy} onChange={(e) => void salvar({ grupoJid: e.target.value || null })}>
          <option value="">Escolha um grupo…</option>
          {s.grupos.map((g) => (
            <option key={g.jid} value={g.jid}>{g.name}</option>
          ))}
        </select>
      </Field>
      <div className="cluster">
        {num("margemMin", "Margem (min)", "Folga mínima antes do horário de saída.")}
        {num("janelaMin", "Janela (min)", "Quantos minutos à frente as OS entram na vigilância.")}
        {num("cadenciaMin", "Cadência (min)", "Intervalo entre ciclos.")}
      </div>
      <Checkbox checked={s.ensaio} disabled={busy} onChange={(e) => void salvar({ ensaio: e.target.checked })} label="Modo ensaio (mostra aqui o que seria enviado e não manda nada)" />
      <h4 className="eyebrow">Acessos</h4>
      {segredos.map((seg) => (
        <Field key={seg.campo} label={seg.rotulo} hint={`${seg.dica}. ${seg.salvo ? "Configurado." : "Não configurado."}`}>
          <div className="cluster">
            <Input type={seg.campo === "dvEnvironmentUrl" ? "url" : "password"} autoComplete="off" value={valores[seg.campo] ?? ""} onChange={(e) => setValores({ ...valores, [seg.campo]: e.target.value })} placeholder={seg.salvo ? "••••••••" : ""} />
            <Button variant="secondary" size="compact" loading={busy} disabled={!valores[seg.campo]} onClick={() => void salvar({ [seg.campo]: valores[seg.campo] }, `${seg.rotulo} salvo.`).then(() => setValores({ ...valores, [seg.campo]: "" }))}>
              Salvar
            </Button>
            {seg.salvo && (
              <Button variant="ghost" size="compact" disabled={busy} onClick={() => void salvar({ [seg.campo]: null }, `${seg.rotulo} removido.`)}>
                Remover
              </Button>
            )}
          </div>
        </Field>
      ))}
      <div className="cluster">
        <Button variant="action" size="compact" loading={busy} disabled={s.faltando.length > 0} onClick={() => void rodar()}>
          Rodar um ciclo agora
        </Button>
        {s.emExecucao && <span className="badge badge--info">Em execução</span>}
      </div>
      {ciclo && (
        <div className="stack">
          <p className="hint">
            Ciclo das {hora(ciclo.em)}{ciclo.ensaio ? " (ensaio)" : ""}: {ciclo.avaliadas.length} OS avaliadas, {ciclo.enviadas.length} avisos{ciclo.erros.length ? `, ${ciclo.erros.length} erros` : ""}.
          </p>
          {ciclo.avaliadas.map((a) => (
            <p key={a.osId} className="hint">
              {a.os}: {NIVEL[a.nivel]}{a.anterior && a.anterior !== a.nivel ? ` (antes: ${NIVEL[a.anterior]})` : ""}{a.folgaMin !== null ? ` · folga ${a.folgaMin} min` : ""}
            </p>
          ))}
          {ciclo.enviadas.map((e, i) => (
            <pre key={i} className="mcp-command" style={{ whiteSpace: "pre-wrap" }}>{e.texto}</pre>
          ))}
          {ciclo.erros.map((e, i) => (
            <p key={i} className="hint hint--warning">{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
```

Se `Switch`/`Checkbox` do design system não aceitarem `label` como prop (confira em `ui/ds/components/Choice.tsx` o tipo `ChoiceBase`), use o componente local `Toggle` de `ui/settings.tsx` exportando-o, ou envolva o input num `<label>`.

- [ ] **Step 3: Ligar em `ui/settings.tsx`**

Import de ícone e painel:

```ts
import { Bell, Briefcase, ChartColumn, Copy, Download, Monitor, Moon, Radar, Sun, Zap, KeyRound, Plus, RefreshCw, Settings2, Smartphone, Tags, Trash2, X } from "lucide-react";
import { VigilanciaPanel } from "./vigilancia.tsx";
```

Na lista de abas, depois de `gastos`:

```ts
  { id: "vigilancia", label: "Vigilância", icon: <Radar size={16} aria-hidden /> },
```

e no tipo `Tab` (procure `type Tab =`) acrescentar `"vigilancia"`. No render, ao lado dos blocos `{tab === "ia" && (...)}`:

```tsx
          {tab === "vigilancia" && (
            <section className="surface stack">
              <h3 className="eyebrow">Vigilância da operação</h3>
              <VigilanciaPanel notify={notify} />
            </section>
          )}
```

- [ ] **Step 4: Verificar na interface**

Run: `pnpm typecheck && pnpm dev` (sem WhatsApp: `node scripts/dev.mjs` respeita `waDisabled` se houver flag; senão conecte normalmente).

Conferir no navegador, em Configurações › Vigilância:
1. Aviso "Falta configurar" lista os seis itens; o interruptor fica desabilitado.
2. Salvar cada acesso muda "Não configurado" para "Configurado" e limpa o campo; o valor não aparece na resposta da rede (`GET /api/vigilancia` só traz booleanos).
3. Escolher um grupo e ligar o interruptor; recarregar a página mantém o estado.
4. Marcar "Modo ensaio" e "Rodar um ciclo agora": a lista de OS e os textos aparecem; nada chega ao WhatsApp.

- [ ] **Step 5: Commit**

```bash
git add ui/api.ts ui/vigilancia.tsx ui/settings.tsx
git commit -m "feat(vigilância): aba Vigilância nas Configurações

Liga/desliga, grupo de destino, margem, janela, cadência, modo ensaio,
acessos (Dataverse, Infleet, TomTom) salvos sem exibir o valor e botão
para rodar um ciclo com o resultado na própria tela.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Documentação e prova por camadas

**Files:**
- Modify: `README.md` (nova seção antes de "## Dados")
- Modify: `.env.example` se existir (`rg -l "DEEPSEEK_API_KEY" .env.example`); senão, só o README.

- [ ] **Step 1: README**

Acrescentar:

```markdown
## Vigilância da operação

Em **Configurações › Vigilância**, o Inbox cruza, a cada 5 minutos, as OS das próximas 2 horas (Dataverse PROD) com a posição dos carros (Infleet) e o tempo de trajeto com trânsito (TomTom; sem chave, OSRM sem trânsito) e avisa um grupo interno do WhatsApp **só quando uma OS entra em risco ou muda de situação**: risco de atraso, atenção (folga menor que a margem), carro parado ou sem sinal perto da hora, OS sem motorista ou veículo, e "normalizou" quando volta ao normal. A redação do aviso usa a API da Anthropic (chave na aba IA); sem chave ou com erro, sai um texto fixo com os mesmos dados.

Precisa de: um grupo do WhatsApp, um app registration no Entra ID com *application user* só de leitura no Dataverse PROD (URL, Tenant ID, Client ID e Client Secret), o token da Infleet e, opcionalmente, uma chave da TomTom (plano grátis: 2.500 rotas/dia). Os acessos ficam no `inbox.db` deste PC, ou em `.env.local` (`DV_ENVIRONMENT_URL`, `DV_TENANT_ID`, `DV_CLIENT_ID`, `DV_CLIENT_SECRET`, `INFLEET_TOKEN`, `TOMTOM_KEY`).

**Modo ensaio** mostra na tela o que seria enviado sem mandar nada: use antes de apontar para o grupo da operação. Roda enquanto o app estiver aberto ou na bandeja. Falhas de fonte por 3 ciclos seguidos geram um aviso no grupo (no máximo um por hora) e outro quando normaliza. As chamadas à API aparecem em **Gastos com IA** como "Vigilância da operação".
```

- [ ] **Step 2: Prova por camadas (manual, registrar o resultado no PR/commit final)**

1. `pnpm typecheck && pnpm test` verdes.
2. Criar o app registration e o application user (fora do código): Entra ID → App registrations → novo app → certificado/segredo; Power Platform admin center → ambiente PROD → Settings → Users + permissions → Application users → adicionar o app com um papel só de leitura em `cr40f_reservadeveculos`, `cr40f_funcionarios`, `cr40f_veiculos`, `cr40f_clientes`. Antes disso, conferir se o service principal previsto no `.env.example` do Sistema Betinhos (`DV_TENANT_ID`/`DV_CLIENT_SECRET`) já existe e tem acesso a PROD.
3. Configurar os acessos na aba, grupo de **teste**, modo ensaio ligado, "Rodar um ciclo agora": conferir OS avaliadas, níveis e textos. Se a consulta OData falhar por nome de navegação (`cr40f_Motorista`/`cr40f_Cliente`), confirmar os nomes em `<url>/api/data/v9.2/$metadata` e ajustar `EXPAND_OS` em `server/vigilancia/dataverse.ts` (mantendo o teste de `montarConsultaOs`).
4. Desligar o ensaio ainda no grupo de teste, ligar a vigilância, acompanhar um turno: um aviso por OS por mudança de nível, "normalizou" ao resolver, gastos registrados.
5. Trocar para o grupo da operação.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(vigilância): seção no README com requisitos, modo ensaio e prova por camadas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Cobertura do spec:** componentes (T1–T7), dados e consulta (T4, T5), regras e transições (T1, T7), mensagem e template (T6), erros por fonte/Claude/WhatsApp/config (T6, T7, T8), configuração e env (T8, T9), botão "Rodar um ciclo" com ensaio (T8, T9), gastos em `ai_usage` (T2, T8), testes listados no spec (T1–T8; `vigilancia-estado` cobre transições em `deveEnviar` + `Store`), prova por camadas (T10).
- **Desvio declarado do spec:** a saída da API é texto simples validado (não vazio, ≤ 12 linhas) em vez de saída estruturada `{ texto }`, para reutilizar exatamente a forma de chamada que já compila em `server/claude.ts`. A chave da Anthropic reutiliza `anthropic_api_key` já existente na aba IA.
- **Consistência de tipos:** `Posicao.fixAt`, `OsVigiada.saidaAt`, `Rota.semTransito`, `Redacao.reserva`, `DepsVigilancia.enviar → string | null`, `StatusVigilancia.segredos` usados com os mesmos nomes em T1, T4–T9.
