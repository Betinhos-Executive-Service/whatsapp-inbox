# Corrigir o Baileys com patch local em vez de trocar de biblioteca

Mensagens perdidas ao reconectar vinham de defeitos do Baileys 7.0.0-rc14 (fila offline pedida só uma vez, migração Número→LID que sobrescreve a sessão do LID, 1º pedido de reenvio sem chaves), não do WhatsApp nem do app. Decidimos manter o Baileys e corrigir esses pontos num patch do pnpm (`patches/@whiskeysockets__baileys@7.0.0-rc14.patch`), porque as alternativas (whatsmeow em Go, wppconnect/whatsapp-web.js com navegador) exigiriam reescrever a camada de conexão e parear todos os aparelhos de novo, sem garantia de não ter defeitos equivalentes.

## Consequências
- Cada atualização do Baileys exige refazer o patch. Remova cada correção quando a versão nova trouxer a sua:
  - fila offline contínua: PR #2926 do Baileys;
  - correção do LID no pedido de reenvio (já no patch antes desta decisão);
  - migração Número→LID que junta sessões;
  - chaves no 1º pedido de reenvio;
  - gravação atômica dos arquivos de chave em `useMultiFileAuthState`.
  - recibo de reenvio só depois do commit da transação;
  - migração Número→LID dentro do mutex da decifragem.
- A junção das sessões depende de um 2º patch, na libsignal (`patches/libsignal@6.0.0.patch`): cada sessão é tentada numa cópia, porque a tentativa na sessão errada avançava o estado dela antes de falhar o MAC. Atualizar a libsignal também exige refazer esse patch.
- Contribuir com as correções no repositório público fica para depois de validá-las com WhatsApp real.
