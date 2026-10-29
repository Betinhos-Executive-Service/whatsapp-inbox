# CLAUDE.md

Inbox local do WhatsApp (Node 24 + pnpm 9, servidor em `server/`, interface React em `ui/`, app desktop Electron só para Windows). Visão geral no `README.md`.

## Verificação
- Skills por área em `.claude/skills/` (índice: `.claude/skills/verificar-index.md`). Versionadas para valerem também nas VMs da nuvem.
- `pnpm dev` e `pnpm build` incrementam a versão no `package.json`; fora de release, desfaça com `git checkout -- package.json`.

## Ambiente cloud (sessões cloud do Claude Code)

- Ambiente "Padrão" em claude.ai/code, com setup script vazio (passe `environment: "Padrão"` no `start_session`). A VM é preparada dentro da sessão pelo hook SessionStart `.claude/hooks/session-start.sh` (registrado em `.claude/settings.json`; só age com `CLAUDE_CODE_REMOTE=true`), que roda `scripts/cloud-setup.sh`: Node 24, pnpm do `packageManager` via corepack, `pnpm install` sem baixar o binário do Electron, `pnpm typecheck`, `pnpm test` e Chromium da imagem (se faltar, só avisa). O PATH do Node 24 vai para o `$CLAUDE_ENV_FILE`. Log em `/tmp/cloud-setup.log`; a sessão abre com `[cloud-setup] Pronto. ...` ou `[cloud-setup] FALHOU ...` no contexto.
- Nenhuma variável nem segredo: o projeto não usa `NODE_AUTH_TOKEN` nem `.env.local`.
- Na VM dá para codar, rodar `pnpm typecheck`, `pnpm test` (usa `tests/fake-api.ts`, sem WhatsApp), subir o servidor sem WhatsApp (`pnpm build && WA_DISABLED=1 pnpm serve`, porta 38291; ou `WA_DISABLED=1 pnpm dev`) e seguir `verificar-servidor` e `verificar-interface` no Chromium headless com o seed fictício.
- Não verificável na VM: WhatsApp real (Baileys, QR, envio, mídia, áudio), app desktop e instalador (Electron, bandeja, atualização), MCP registrado no Claude Code, botão Claude, classificação por IA (Jev/DeepSeek/Anthropic), Vigilância (Dataverse PROD, Infleet, TomTom). A sessão cloud entrega o PR e declara essas partes como "não verificadas na nuvem".
- Proibido na nuvem: subir o servidor sem `WA_DISABLED=1`; conectar ou parear WhatsApp; enviar qualquer mensagem; criar `.env.local` ou usar chaves reais; `pnpm release`, `pnpm exe`, `pnpm app`; push ou merge na `main` (todo push na `main` publica release pelo `.github/workflows/release.yml`); qualquer escrita em PROD (Dataverse, Infleet).
- Fatos da VM (medidos em 19/10/2026): Node 22 na imagem em `/opt/node22/bin` e nvm em `/opt/nvm` (o setup instala o 24 por ele); o shell da sessão não lê `~/.bashrc`; pnpm 12 pré-instalado (o setup usa o 9.15.9 do `packageManager` via corepack; na sessão, prefira `corepack pnpm` se `pnpm -v` não der 9.15.9), Chromium em `$PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (build 1194). O CDN do Playwright é bloqueado: para screenshot use `npx playwright@1.56.1` (casa com o build da imagem) e nunca baixe outro navegador.
- Teste do setup num Linux limpo: `verificar-ambiente-cloud` (`scripts/testa-cloud-setup.sh` no WSL). A prova final é uma sessão cloud nova depois do merge (só a `main` vale para sessões novas).
