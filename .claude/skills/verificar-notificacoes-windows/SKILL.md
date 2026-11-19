---
name: verificar-notificacoes-windows
description: "Verifica o registro das notificações no Windows (AUMID br.com.betinhos.whatsapp-inbox: DisplayName e IconUri) e se um toast do app não faz o ShellExperienceHost crescer. Use após mudar registerNotificationName, iconPath, APP_ID ou os toasts em desktop/main.ts."
---
# Verificar notificações no Windows

## Cobre
- `desktop/main.ts`: `registerNotificationName` (chave `HKCU\Software\Classes\AppUserModelId\br.com.betinhos.whatsapp-inbox`), `iconPath`, `APP_ID`.
- Resultado: `IconUri` aponta para `<userData>\notification-icon.png` (PNG de poucos KB, 256x256), nunca para o `.exe`. Com o `.exe` (~235 MB), o ShellExperienceHost lê o arquivo inteiro a cada toast e não libera (cada toast somava ~236 MB; chegou a 34 GB).

## Preparar ambiente
- Windows, `pnpm install`. O app instalado pode continuar aberto: o teste usa `--user-data-dir` próprio, então não briga pela trava de instância única.
- Compilar sem abrir o app: `ELECTRON_RUN_AS_NODE=1 node scripts/desktop.mjs --run` (o Electron em modo Node falha de propósito) e depois `git checkout package.json` (o build sobe a versão).

## Roteiro (PowerShell)
1. Guardar o valor atual: `$k='HKCU:\Software\Classes\AppUserModelId\br.com.betinhos.whatsapp-inbox'; $orig=(Get-ItemProperty $k).IconUri`.
2. Simular versão antiga: `Set-ItemProperty $k IconUri '<caminho do WhatsApp Inbox.exe>'`.
3. Abrir o app novo isolado: `Start-Process node_modules\electron\dist\electron.exe -ArgumentList '.','--user-data-dir="<pasta temporária>"'`; esperar ~10 s.
4. Conferir: `IconUri` = `<pasta temporária>\notification-icon.png` e o arquivo existe com poucos KB.
5. Encerrar só esse electron (filtrar `CommandLine` pela pasta temporária) e restaurar `$orig`.
6. Memória: medir `(Get-Process ShellExperienceHost).PrivateMemorySize64`, mostrar um toast com `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('br.com.betinhos.whatsapp-inbox').Show(...)` e medir de novo após 8 s. Esperado: variação perto de zero. Falha: salto de ~236 MB (cópia do `.exe`; confirme com VirtualQueryEx: blocos privados de 234 MiB que começam com `MZ`). Limpar com `ToastNotificationManager::History.Clear(<AUMID>)`.

## Casos de borda
- `dist/icon.ico` ausente (dev sem build do ícone): o app apaga `IconUri` em vez de deixar o `.exe`.
- PNG já igual no disco: não regrava (o shell pode estar com o arquivo aberto).
