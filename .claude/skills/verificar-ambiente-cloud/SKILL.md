---
name: verificar-ambiente-cloud
description: "Verifica o preparo da VM cloud do Claude Code (hook SessionStart + scripts/cloud-setup.sh) num Linux limpo. Use após mudar scripts/cloud-setup.sh, scripts/testa-cloud-setup.sh, .claude/hooks/session-start.sh, .claude/settings.json, .npmrc, package.json (packageManager, engines, dependências que baixam binário), pnpm-lock.yaml de forma que afete instalação, ou a seção 'Ambiente cloud' do CLAUDE.md."
---
# Verificar ambiente cloud

## Cobre
- Código: `scripts/cloud-setup.sh`, `scripts/testa-cloud-setup.sh`, `.claude/hooks/session-start.sh`, `.claude/settings.json` (registro do hook SessionStart), `.npmrc`, `.gitattributes`, `package.json` (`packageManager`, `engines`), `pnpm-lock.yaml`, `patches/**`.
- Resultado: na VM, o hook roda o `cloud-setup.sh` só com `CLAUDE_CODE_REMOTE=true` e deixa Node 24, pnpm do `packageManager`, dependências sem o binário do Electron, `pnpm typecheck` e `pnpm test` passando, Chromium da imagem e o PATH do Node no `$CLAUDE_ENV_FILE`. Falha do setup nunca bloqueia a sessão. Sem token nem segredo.

## Preparar ambiente
- Linux limpo que simula a VM: WSL `Ubuntu` como root, pastas descartáveis `/root/sb-whatsapp` e HOME `/root/sbhome-whatsapp` (o roteiro apaga e recria). O hook roda num `/tmp` privado (`unshare -m` + tmpfs) para não misturar o `/tmp/cloud-setup.log` com outras sessões.
- Outras sessões podem usar o mesmo WSL: mantenha os nomes com `-whatsapp` (pastas, `/root/run*-whatsapp.log`, `/tmp/repo-whatsapp.tar`, `/tmp/testa-whatsapp.sh`) e rode um teste deste repo por vez.

## Roteiro
1. `bash -n scripts/cloud-setup.sh .claude/hooks/session-start.sh` → sem saída. `file scripts/cloud-setup.sh` não pode citar CRLF (`.gitattributes` força LF em `*.sh`). `.claude/settings.json` é JSON válido e tem `SessionStart` com `matcher` `startup|resume`.
2. Arquivos novos ainda não commitados: `git add -N <arquivos>` (senão ficam fora do tar). Confira com `git ls-files .claude` que `hooks/session-start.sh` e `settings.json` são versionados.
3. No Git Bash (10 a 30 min com o WSL disputado; rode em segundo plano):
   ```bash
   export MSYS_NO_PATHCONV=1
   git ls-files -z | tar --null -T - -cf /tmp/repo-whatsapp.tar
   cp scripts/testa-cloud-setup.sh /tmp/testa-whatsapp.sh
   wsl.exe -d Ubuntu -u root bash /mnt/c/Users/mendo/AppData/Local/Temp/testa-whatsapp.sh /mnt/c/Users/mendo/AppData/Local/Temp/repo-whatsapp.tar
   ```
   (`/tmp` do Git Bash = `C:\Users\mendo\AppData\Local\Temp`; o projeto não usa GitHub Packages, então não exporte token.) Esperado:
   - `direto exit=0 | [cloud-setup] Pronto. WhatsApp Inbox: typecheck e testes ok; Chromium: ...` e as linhas `ℹ tests N`, `ℹ pass N`, `ℹ fail 0`
   - `hook exit=0 | [cloud-setup] Pronto. ...` e `hook resume exit=0 | [cloud-setup] Pronto. ...` (idempotente)
   - `PATH no env da sessão: 1 linha(s) | v24.x 9.15.9` (sem duplicar no resume; `pnpm` do corepack)
   - `hook fora da nuvem exit=0 | saída: ''`
   - `hook com falha exit=0 | [cloud-setup] FALHOU (exit 3). ...`
   - `versão do package.json intacta: sim`, `binário do Electron baixado: não`, `token vazado nos logs: 0`
   - Chromium: o WSL desta máquina é Ubuntu 26.04, que o Playwright 1.55 não suporta; lá pode sair `Chromium: FALHOU (...)` (ou `instalado`, pelo fallback 24.04) e o exit continua 0. Na VM cloud o Chromium vem da imagem (`$PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) e sai `já instalado`.

## Evidência obrigatória
- Saída do passo 3 em `.verificacao/<data>-<branch>/teste-wsl.log`.

## Limites
- O WSL simula a VM, mas a imagem da nuvem traz Node 22, nvm em `/opt/nvm`, pnpm 12 e Chromium. A prova final é uma sessão cloud nova no ambiente "Padrão" depois do merge (só a `main` vale para sessões novas): ela deve abrir com `[cloud-setup] Pronto.` no contexto; relate se vier `FALHOU`.
- `--with-deps` do Playwright usa `apt` (precisa de root); sem root, cai no download só do Chromium.
