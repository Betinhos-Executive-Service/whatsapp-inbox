; Substitui a checagem padrão de "app em execução" do electron-builder.
; Além da janela, sessões do Claude Code mantêm o "WhatsApp Inbox.exe" rodando
; como servidor MCP (ELECTRON_RUN_AS_NODE), e a checagem padrão não consegue
; fechá-los. Encerra todos os processos do executável antes de instalar.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 1500
!macroend
