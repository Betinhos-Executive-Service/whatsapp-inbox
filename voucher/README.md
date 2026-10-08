# Template do voucher de confirmação

Cópia sem alterações dos arquivos da **Tela Voucher de Confirmação** (WebResource `cr40f_VoucherConfirmacao.*`, v0.1.14, commit `e8423da` de 12/09/2026).

O app usa o template para gerar o PDF do voucher que o Claude propõe na conversa (`propor_voucher`): `server/voucher.ts` troca o `Xrm` do Dynamics pelos dados que o Claude leu do Dataverse e imprime em A4 com o Edge ou o Chrome em modo headless. O build copia a pasta para `dist/voucher/`.

Para atualizar: copie de novo os quatro arquivos da Tela Voucher e confira o PDF gerado (`pnpm test` cobre a montagem do HTML).
