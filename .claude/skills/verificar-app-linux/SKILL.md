---
name: verificar-app-linux
description: "Verifica o app desktop no Linux (AppImage): build, latest-linux.yml, servidor MCP pelo .AppImage e o app abrindo. Use após mudar desktop/**, scripts/desktop.mjs, scripts/icon.mjs, scripts/ui-build.mjs (bumpVersion), o bloco build/linux/appImage do package.json ou o job linux do .github/workflows/release.yml."
---
# Verificar app Linux (AppImage)

## Cobre
- Código: `desktop/**` (em especial `desktop/linux.ts` e os ramos `linux` do `desktop/main.ts`), `scripts/desktop.mjs`, `scripts/icon.mjs` (PNG), `package.json` (`desktopName`, `build.linux`, `build.appImage`), `.github/workflows/release.yml` (job `linux`).
- Resultado: `pnpm exe` no Linux gera `release/WhatsApp-Inbox.AppImage` (nome fixo: a atualização substitui o arquivo e o caminho do MCP e do autostart continua valendo) e `release/latest-linux.yml`; `.AppImage --mcp-server` responde ao `initialize` do MCP e encerra quando o stdin fecha; o app fica aberto sem cair.

## Preparar ambiente
- WSL `Ubuntu` com usuário comum (o Electron recusa root sem `--no-sandbox`) e `libfuse2t64` instalado (`wsl -d Ubuntu -u root -- apt-get install -y libfuse2t64`). WSLg dá a tela; nenhum navegador extra.
- Rede para baixar Node 24 (1ª vez, em `~/.cache/node24-whatsapp`), o Electron Linux e o appimagetool.

## Roteiro
1. Arquivos novos ainda sem commit: `git add -N <arquivos>`.
2. No Git Bash (3 a 6 min):
   ```bash
   export MSYS_NO_PATHCONV=1
   # /tmp do Git Bash = %TEMP%; "C:/..." no tar viraria host remoto.
   git ls-files -co --exclude-standard -z | tar --null -T - -cf /tmp/repo-whatsapp.tar
   cp scripts/testa-appimage.sh /tmp/testa-appimage-whatsapp.sh
   W="/mnt/c/Users/$USERNAME/AppData/Local/Temp"
   wsl.exe -d Ubuntu -- bash "$W/testa-appimage-whatsapp.sh" "$W/repo-whatsapp.tar" 2>&1 | tr -d '\0'
   ```
3. Esperado: `pacote ok`, `mcp ok` (2 a 15 s), `app ok: ficou aberto 25 s`. O build incrementa a versão só na cópia do WSL.
4. Mudou o fluxo de publicação (`--publish`)? Leia o ramo `linux` do `publishRelease`: anexa à release existente da tag `v<versão>`, sem criar commit nem tag. O CI só prova de verdade num push na `main` (publica release: só com OK do usuário).

## Não verificável aqui
- Bandeja (GNOME precisa da extensão AppIndicator), notificações e autostart numa sessão real; colar arquivo copiado (wl-copy/xclip, só `text/uri-list`); voucher em PDF (precisa de Chrome/Edge/Chromium fora do snap); atualização automática entre duas versões publicadas.
