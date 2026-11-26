# Fila offline completa e sessões de criptografia sãs

- Nível: 2 (patch no Baileys e integração do WhatsApp no servidor e no desktop; revisão com Opus por mexer em criptografia)
- Etapa: 5 de 7 Construir
- Próximo passo: qualidade antes do PR, testes no Windows, PR e merge · sozinho
- Branch e PR: t3/fila-offline-e-sessao · ainda não
- Protótipo: sem protótipo (sem UI)
- Go: 26/11/2026 10:45 por Renan ("Go, até o merge")
- Atualizado: 26/11/2026 11:54

## Decisões
| Data | Decisão | Por quê | Quem decidiu |
|---|---|---|---|
| 26/11/2026 | Q1: pedir a fila offline até o WhatsApp avisar o fim (porta do PR #2926 do Baileys) | 5 de 5 filas de hoje terminaram pelo limite de 90 s, sem aviso de fim | Renan |
| 26/11/2026 | Q2: mandar nossas chaves já no 1º pedido de reenvio | o contato nunca respondia ao 1º pedido sem chaves, e o 2º nunca saía | Renan |
| 26/11/2026 | Q3: gravação atômica dos arquivos de chave (temporário + rename), mesmo formato | queda no meio da escrita deixa arquivo truncado; não exige parear de novo | Renan |
| 26/11/2026 | Q4: antes de instalar atualização, esperar as chaves gravarem e fechar o WhatsApp limpo | a corrida de 5 s pode matar o processo no meio de uma escrita | Renan |
| 26/11/2026 | Q5: na migração Número→LID, juntar as sessões em vez de sobrescrever a do LID | a sobrescrita apaga a sessão boa e gera "No matching sessions" | Renan |
| 26/11/2026 | Q6: parear de novo uma vez, logo após o release | sessões já quebradas não se consertam sozinhas | Renan |
| 26/11/2026 | Q7: não gravar o contador de reenvio em disco | com chaves no 1º pedido o contador deixa de importar | Renan |
| 26/11/2026 | ADR 0001: manter o Baileys com patch local em vez de trocar de biblioteca | ver docs/adr/0001-patch-local-do-baileys.md | Renan |
| 26/11/2026 | Contribuir com o Baileys: decidir depois de 2 a 3 dias de validação | ação pública; precisa de prova com WhatsApp real antes | Renan |

## Tarefas e provas
| # | Tarefa | Depende de | Cenário (ação → resultado) | Prova | Nível | Resultado |
|---|---|---|---|---|---|---|
| 1 | Patch: fila offline contínua | - | aviso de prévia da fila → pede de novo a cada 100 itens e a cada 10 s até o aviso de fim | teste com socket falso | 4 | feito: `tests/baileys-patch.test.ts` passa; sem o patch falha em "2º pedido depois de 100 itens" |
| 2 | Patch: chaves no 1º reenvio | - | 1ª falha de decifrar → recibo de reenvio já leva as chaves | teste do recibo com contador 1 | 4 | feito: passa; sem o patch falha em "chaves no 1º pedido" |
| 3 | Patch: migração junta sessões | - | sessão do Número migra sobre sessão existente do LID → as duas continuam no registro | teste com SessionRecord real do libsignal | 5 | feito: sem o patch o teste reproduz o erro de produção "No matching sessions found for message"; com o patch decifra |
| 4 | Patch: gravação atômica (Assumi: no `useMultiFileAuthState` do Baileys, que é quem grava) | - | escrita interrompida → arquivo antigo intacto, sem arquivo parcial | teste do gravador | 4 | feito: escrita que falha deixa o arquivo antigo intacto, sem `.tmp` sobrando |
| 5 | App: atualização fecha limpo | 4 | atualização baixada → espera gravar chaves e fechar o socket antes de instalar | teste do `stop()` | 4 | feito: `stop()` espera a gravação (sem a espera o teste falha); limite da instalação 5 s → 25 s (Vigilância 10 s + gravações 10 s, em série) |
| 6 | Revisão Opus: correções | 1-5 | sessão errada tentada antes da certa, migração em paralelo com a decifragem, queda antes do commit do reenvio, gravação presa no Windows, logout com gravação atrasada → nada se perde | testes que falham sem cada correção | 5 | feito: 6 correções (patch novo na libsignal, migração no mutex, recibo depois do commit, teto de 10 s no `stop()`, logout espera as gravações, rename com até ~1,5 s de novas tentativas); 308/308 testes |
| 7 | Validar com WhatsApp real no notebook | 1-6, release | parear de novo, desligar a internet, receber mensagens, religar → todas chegam; log "fila offline terminou" | log do conexao.log | 5 | pendente |

## Pendências e fora de escopo
- Propor as correções ao Baileys (issue ou PR público): decidir depois da validação.
- Trocar de biblioteca: descartado (ADR 0001).
- Lacunas da revisão Opus, fora do escopo: migração fora do mutex na sincronização do próprio mapeamento e ao conectar; o envio não espera a migração; o `nextPreKeyId` continua salvo de forma assíncrona (já era assim).

## Retro
-
