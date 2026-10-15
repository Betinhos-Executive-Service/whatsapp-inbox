; Substitui a checagem padrão de "app em execução" do electron-builder.
; Além da janela, sessões do Claude Code mantêm o "WhatsApp Inbox.exe" rodando
; como servidor MCP (ELECTRON_RUN_AS_NODE), e a checagem padrão não consegue
; fechá-los. Encerra todos os processos do executável antes de instalar.
; Sem /T: na atualização pelo app o instalador é filho do "WhatsApp Inbox.exe",
; e encerrar a árvore mataria o próprio instalador. /IM já pega todos pelo nome.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 1500
!macroend
