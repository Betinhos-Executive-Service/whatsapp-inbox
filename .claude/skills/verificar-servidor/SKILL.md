---
name: verificar-servidor
description: "Verifica o servidor local do WhatsApp Inbox (API HTTP, banco SQLite, IA, MCP, voucher, vigilância) e os scripts de build: typecheck, testes e subida sem WhatsApp. Use após mudar server/**, tests/**, scripts/**, voucher/** ou package.json."
---
# Verificar servidor

## Cobre
- Código: `server/**`, `tests/**`, `scripts/**`, `voucher/**`, `package.json`, `tsconfig.json`.

## Preparar ambiente
- `pnpm install --frozen-lockfile` (worktree novo não tem `node_modules`).
- Sem `.env.local`: nenhuma chave de IA, Dataverse ou Infleet é usada.

## Roteiro
1. `pnpm typecheck` → sai sem saída e código 0.
2. `pnpm test` → resumo `ℹ fail 0` (302 testes em 26/11/2026; o número só cresce).
3. Subida: `preview_start` com `inbox-dev-sem-whatsapp` → log "WhatsApp Inbox em http://127.0.0.1:38291"; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:38291/` → `200`; `GET /api/chats` → 200 com JSON.
4. Rota mudada: chamar pelo navegador interno (`fetch` na página, mesma origem) e conferir status e corpo. Rotas recusam outra origem e escutam só em 127.0.0.1.

## Casos de borda
- Porta 38291 ocupada por instância anterior: `scripts/dev.mjs` encerra se o comando for `server/main.ts`; outro serviço → falha com PID.
- Carimbo de hora do WhatsApp no futuro (relógio do contato ou deste PC adiantado): `arrivalAt` em `server/history.ts` grava `agora` e avisa no log uma vez por minuto; coberto em `tests/messages.test.ts` (helper) e `tests/timestamp.test.ts` (ingestão completa: áudio, reação e lote de histórico), sem WhatsApp.
- Horário da mensagem enviada: nasce com o relógio deste PC e, no ack do WhatsApp (`applyAck`, atributo `t`), passa ao horário do servidor limitado a agora (`Store.setSentAt`); coberto em `tests/delivery.test.ts` (relógio adiantado, atrasado e ack sem `t`). Se o ack real traz `t`, só com WhatsApp real.
- Chaves de sincronização do estado do app (arquivar, fixar, marcar como não lida): nomes em hex para não colidir por maiúscula no Windows; `tests/app-state-keys.test.ts` simula a pasta sem diferença de maiúscula. Pedido e resposta das chaves pelo celular só com WhatsApp real.
- Mensagem que não decifrou (stub CIPHERTEXT): vira aviso `WAITING_TEXT` não lido e sem recibo de leitura; o reenvio com o mesmo id o substitui (`Store.fillWaiting`) ou o remove se for reação/edição/apagada (`Store.dropWaiting`); no lote do histórico não cria aviso. Coberto em `tests/waiting.test.ts` e `tests/offline-batch.test.ts`. Se o reenvio chega de fato e se a sessão do LID é refeita (patch do Baileys em `sendRetryRequest`) só com WhatsApp real: conferir as linhas `baileys: ...` no `conexao.log`.
- Patch do Baileys (`patches/@whiskeysockets__baileys@7.0.0-rc14.patch`): fila offline pedida em lotes até o aviso de fim, chaves já no 1º recibo de reenvio, migração Número→LID que junta as sessões e gravação atômica dos arquivos de chave. Coberto em `tests/baileys-patch.test.ts`, com criptografia em memória e socket contra um WebSocket local, sem WhatsApp. Para provar que um teste pega o defeito: salve o arquivo de `node_modules/@whiskeysockets/baileys/lib/...`, desfaça a correção nele, veja o teste falhar e restaure a cópia. Chegada real da fila e resposta do contato ao reenvio só com WhatsApp real: `fila offline terminou` e `chegou no reenvio` no `conexao.log`.
- Patch da libsignal (`patches/libsignal@6.0.0.patch`): com várias sessões no registro (depois da migração Número→LID), cada tentativa de decifrar roda numa cópia e só a que passa no MAC altera o registro. Coberto pelo teste de sessão mesclada em `tests/baileys-patch.test.ts`. A cópia instalada fica em `node_modules/.pnpm/libsignal@6.0.0_patch_hash=*/node_modules/libsignal/src/session_cipher.js` (não em `node_modules/libsignal`); para editar, `pnpm patch libsignal@6.0.0 --edit-dir <pasta>` e `pnpm patch-commit <pasta>`.
- Encerramento: `WhatsApp.stop()` espera as gravações de chaves e credenciais em andamento (a atualização espera até 25 s, depois dos até 10 s da Vigilância); coberto em `tests/close.test.ts`.
- Depois de `preview_stop`, conferir com `netstat -ano | grep ":38291 .*LISTEN"`; o filho `node server/main.ts` pode sobrar e precisa de `taskkill /PID <pid> /T /F` (só se o comando for `server/main.ts`).

## Evidência obrigatória
- Saída final de `pnpm test` e de `pnpm typecheck` em `.verificacao/<data>-<branch>/`.

## Limites
- WhatsApp real (Baileys), Claude Code, Dataverse PROD, Infleet e TomTom não rodam aqui; `tests/fake-api.ts` cobre a API sem eles.
- `pnpm dev` incrementa a versão do `package.json`: desfazer com `git checkout -- package.json` fora de release.
