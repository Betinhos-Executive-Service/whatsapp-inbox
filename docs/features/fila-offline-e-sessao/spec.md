# Fila offline completa e sessões de criptografia sãs

## Objetivo
Ao reconectar, o **Aparelho conectado** recebe a **Fila offline** inteira, e as **Mensagens aguardando** voltam pelo **Reenvio** em vez de ficarem presas para sempre.

## Causa (resumo)
- Baileys pede só um lote de 100 itens da fila offline e nunca pede o resto; o que sobra fica retido até a próxima reconexão.
- Na migração do **Número** para o **LID**, o Baileys sobrescreve a **Sessão de criptografia** do LID com a do Número, e as mensagens novas não abrem.
- O 1º pedido de **Reenvio** sai sem as nossas chaves; o contato não responde e o 2º pedido nunca sai.
- O app grava as chaves sem proteção contra queda e reinicia a cada atualização com uma corrida de 5 s.

## Entra
1. Patch no Baileys: pedir a fila offline em lotes até o aviso de fim.
2. Patch no Baileys: chaves já no 1º pedido de reenvio.
3. Patch no Baileys: a migração Número→LID junta as sessões.
4. Patch no Baileys: gravação atômica dos arquivos de chave (`useMultiFileAuthState`), no mesmo formato.
5. App: antes de instalar uma atualização, esperar as gravações e fechar o WhatsApp limpo.

## Fora
- Trocar de biblioteca. Gravar em disco o contador de reenvio. Mudança de interface.

## Aceite
- Fila com mais de 100 itens: o app pede de novo até receber o aviso de fim, e o log registra "fila offline terminou".
- Mensagem que não decifrou: o 1º recibo de reenvio leva as chaves.
- Migração Número→LID com sessão já existente no LID: as duas sessões ficam no registro.
- Queda no meio da gravação de uma chave: o arquivo anterior fica intacto.
- Atualização: o app só chama o instalador depois de fechar o WhatsApp e gravar as chaves (com limite de tempo para não travar).

## Irreversível
- Nada nos dados locais. O re-pareamento depois do release é manual e combinado (Q6).
- Não verificável fora do WhatsApp real: chegada da fila, resposta do contato ao reenvio.
