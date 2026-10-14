# Vigilância da operação — design

Data: 14/10/2026 · Abordagem aprovada: regras determinísticas em código decidem o risco; a API da Anthropic só redige a mensagem.

## Objetivo

A cada 5 minutos, cruzar as OS das próximas 2 horas (Dataverse PROD) com a posição dos carros (Infleet) e o tempo de trajeto com trânsito (TomTom, OSRM de reserva). Quando uma OS entra em risco de atraso, ou muda de nível, enviar uma mensagem em linguagem natural para o grupo interno da operação pelo WhatsApp conectado ao Inbox. Nada é enviado enquanto está tudo bem.

## Onde roda

Módulo novo no server do WhatsApp Inbox (`server/vigilancia/`). Roda enquanto o app estiver aberto ou na bandeja, com o mesmo padrão do `fireReminders` (`setInterval` com `unref`). Depende do PC do Inbox ligado, condição que já vale para o próprio Inbox.

Fora de escopo: Teams, WhatsApp Cloud API, Worker Cloudflare, alerta por DM.

## Componentes (`server/vigilancia/`)

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `dataverse.ts` | Token por client credentials (Entra, `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`, escopo `<DV_ENVIRONMENT_URL>/.default`) com cache até expirar. Consulta OData em `cr40f_reservadeveculos` e devolve `OsVigiada[]`. | `fetch` |
| `infleet.ts` | Port de `Skill Agendamento/infleet-mcp/lib.mjs`: uma consulta GraphQL com a posição de toda a frota (placa, lat/lon, velocidade, ignição, `fixTime`, motorista). | `fetch`, `INFLEET_TOKEN` |
| `geo.ts` | Geocodificação do endereço de embarque via Nominatim (1 req/s, `User-Agent` próprio) com cache permanente em SQLite (`vigilancia_geocache`). Rota com trânsito via TomTom Routing (`api.tomtom.com/routing/1/calculateRoute`, `traffic=true`); se faltar chave ou falhar, OSRM `route` (sem trânsito, flag `semTransito: true`). | `fetch`, `TOMTOM_KEY` |
| `regras.ts` | Funções puras. `avaliar(os, posicao, rota, agora, config) → Avaliacao { nivel, fatos }`. Sem I/O. | nada |
| `mensagem.ts` | `redigir(avaliacao) → string`. Chama `@anthropic-ai/sdk` (`claude-opus-5-5`, `output_config.effort: "low"`, saída estruturada `{ texto: string }`, `max_tokens` 1024). Em erro ou timeout (20 s), devolve o template fixo com os mesmos fatos. | SDK, `ANTHROPIC_API_KEY` |
| `estado.ts` | Tabela `vigilancia_alertas (os_id text primary key, nivel text not null, enviado_em integer not null)`. `nivelAnterior(osId)`, `registrar(osId, nivel)`. | `db.ts` |
| `job.ts` | Orquestra um ciclo (`executarCiclo`) e o agendamento (`iniciarVigilancia(deps, config)`). Modo ensaio: loga e não envia. | todos acima, `whatsapp.send` |

## Dados

### OS vigiada (Dataverse)

Consulta: `cr40f_reservadeveculos` com `cr40f_dataehorriodesada ge agora and lt agora+janela`, status ativo (valores confirmados na metadata PROD durante a implementação; o status de cancelada/concluída fica de fora), `$expand` de `cr40f_Motorista` (`cr40f_nomecompleto`, `new_apelido`), `cr40f_Cliente` (`cr40f_nomedocliente`) e do veículo (placa). Campos: id, horário de saída, `cr40f_enderecodesaida`, passageiro (campo confirmado na metadata), tipo do serviço.

Sem `cr40f_enderecodesaida` geocodificável: a OS só participa da regra `sem_programacao`; a mensagem avisa "embarque sem endereço localizável" uma única vez por OS.

### Posição (Infleet)

Uma consulta por ciclo para toda a frota. Índice por placa normalizada (sem hífen, maiúscula). `fixTime` define "minutos sem atualizar".

### Rota

Só para OS com embarque a no máximo 60 min. Uma chamada por OS por ciclo (TomTom, ou OSRM). Cota TomTom grátis: 2.500/dia; estimativa com 20 OS/dia: ~250 rotas/dia.

## Regras (`regras.ts`)

Entradas: `os`, `posicao` (ou nula), `rota` (ou nula), `agora`, `config { margemMin: 10, janelaMin: 120, rotaAteMin: 60, paradoAteMin: 30, paradoDistKm: 1, paradoMin: 10, semSinalMin: 10 }`.

Ordem de avaliação (a primeira que casar vence):

1. `sem_programacao`: OS sem motorista ou sem veículo.
2. `sem_sinal`: faltam ≤ `paradoAteMin` para o embarque, carro a mais de `paradoDistKm` do embarque e `fixTime` há mais de `semSinalMin`.
3. `parado`: faltam ≤ `paradoAteMin`, carro a mais de `paradoDistKm` do embarque, velocidade 0 e ignição desligada há mais de `paradoMin` (comparado com a posição do ciclo anterior guardada em memória; sem histórico, não dispara).
4. `atraso`: `agora + rota.duracaoMin > horarioSaida`.
5. `atencao`: `agora + rota.duracaoMin > horarioSaida − margemMin`.
6. `ok`.

Carro a menos de `paradoDistKm` do embarque é sempre `ok` (chegou). Sem rota (fora da janela de 60 min, ou erro), só as regras 1–3 valem.

`fatos` leva tudo que a mensagem precisa: OS, cliente, passageiro, motorista (apelido), placa, embarque (endereço), horário de saída, posição atual (endereço Infleet, minutos sem atualizar), minutos de trajeto, previsão de chegada, folga/atraso em minutos, `semTransito`.

## Transições e envio

- Envia quando `nivel !== nivelAnterior(os)`, com duas exceções: `ok` sem alerta anterior não envia; `atencao` depois de `atraso` não envia (ainda está em risco, evita ruído). `ok` depois de qualquer alerta envia "normalizou".
- Envio pelo `whatsapp.send(jidGrupo, texto)`. Só registra o estado depois de o envio devolver id; WhatsApp desconectado deixa o estado como estava e o ciclo seguinte tenta de novo.
- OS que sai da janela (horário passou há mais de 30 min) tem o estado apagado.

## Mensagem

Prompt do sistema fixo (cacheável): tom Betinhos (humano, preciso, seguro), formato WhatsApp (`*negrito*`, marcadores `•`, parágrafos curtos, sem introdução), pt-BR, horário em America/Sao_Paulo, nunca inventar dados além dos fatos, no máximo 6 linhas. Entrada do usuário: `fatos` em JSON. Saída estruturada `{ texto }`.

Template de reserva (sem Claude), exemplo para `atraso`:

```
*⚠️ Risco de atraso — OS 1234*
• Cliente: Acme · Passageiro: Fulano
• Motorista: Beto · Placa ABC1D23
• Embarque 14:00 em Av. Paulista, 1000
• Carro em Rod. Castello Branco km 20, previsão 14:12 (12 min de atraso, com trânsito)
```

Uso da API registrado em `ai_usage` (provider novo `anthropic`, kind `vigilancia`, tokens e custo pela tabela de `pricing.ts`).

## Erros

| Falha | Comportamento |
|---|---|
| Dataverse, Infleet ou rota (TomTom e OSRM) fora | Pula o ciclo, loga. A partir do 3º ciclo seguido sem dados de uma fonte, envia "vigilância sem dados: <fonte>" ao grupo, no máximo uma vez por hora; ao voltar, envia "vigilância normalizada". |
| TomTom fora, OSRM ok | Usa OSRM; `fatos.semTransito = true` e a mensagem diz "tempo sem trânsito". |
| Nominatim fora | OS sem cache de geocodificação fica só com as regras 1–3 neste ciclo. |
| Anthropic fora/timeout | Template fixo; alerta nunca se perde. |
| WhatsApp desconectado | Nada enviado nem registrado; repete no próximo ciclo. |
| Config incompleta (sem grupo, sem segredo) | Vigilância não inicia; Configurações mostra o que falta. |

Logs pelo logger do server, nunca com segredos.

## Configuração (Configurações › Vigilância)

Guardadas em `settings` como as chaves de IA existentes (`vigilancia_*`), com os segredos também aceitos por variável de ambiente em `.env.local`:

| Chave | Padrão | Origem alternativa |
|---|---|---|
| `vigilancia_ativa` | `0` | — |
| `vigilancia_grupo_jid` | — (escolhido na lista de grupos do Inbox) | — |
| `vigilancia_margem_min` | `10` | — |
| `vigilancia_janela_min` | `120` | — |
| `vigilancia_cadencia_min` | `5` | — |
| `vigilancia_ensaio` | `0` (modo ensaio: loga, não envia) | — |
| `anthropic_api_key` | — | `ANTHROPIC_API_KEY` |
| `dv_environment_url`, `dv_tenant_id`, `dv_client_id`, `dv_client_secret` | — | `DV_ENVIRONMENT_URL`, `DV_TENANT_ID`, `DV_CLIENT_ID`, `DV_CLIENT_SECRET` |
| `infleet_token` | — | `INFLEET_TOKEN` |
| `tomtom_key` | — (opcional) | `TOMTOM_KEY` |

Pré-requisito fora do código: app registration no Entra com client secret e application user no Dataverse PROD com papel só de leitura em `cr40f_reservadeveculos`, `cr40f_funcionarios`, `cr40f_veiculos` e `cr40f_clientes`. O `.env.example` do Sistema Betinhos já prevê um service principal de CI; conferir se ele existe e se tem acesso a PROD antes de criar outro.

Botão "Rodar um ciclo agora" na tela de configuração, respeitando o modo ensaio, com o resultado (OS avaliadas, níveis, mensagens que seriam enviadas) exibido na própria tela.

## Testes (`node --test tests/*.test.ts`)

- `vigilancia-regras.test.ts`: cada nível, prioridade entre regras, carro já no local, OS sem endereço, sem rota, parado sem histórico.
- `vigilancia-estado.test.ts`: transições (novo alerta, escalada, `atencao` após `atraso` não envia, `ok` após alerta envia, limpeza de OS passada).
- `vigilancia-mensagem.test.ts`: template de reserva, parse da saída estruturada, fallback em erro e timeout, com SDK mockado.
- `vigilancia-dataverse.test.ts` e `vigilancia-infleet.test.ts`: URL/filtro OData e query GraphQL montados, parse das respostas, cache de token, com `fetch` mockado.
- `vigilancia-geo.test.ts`: cache Nominatim, TomTom com `traffic=true`, queda para OSRM com `semTransito`.
- `vigilancia-job.test.ts`: um ciclo completo com todas as dependências mockadas: só OS que mudou de nível gera envio; envio falho não registra estado; contador de falhas por fonte.

Prova por camadas, nesta ordem: testes unitários; um ciclo em modo ensaio contra PROD (leitura) com o resultado na tela; envio real para um grupo de teste; só então o grupo da operação.

## Versão

Segue o padrão do projeto (`package.json` incrementado no release; a UI já mostra a versão).
