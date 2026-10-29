#!/bin/bash
# SessionStart: prepara a VM das sessões cloud do Claude Code (Node, deps, Chromium, checagem).
# Roda aqui, e não no setup script do ambiente, porque as variáveis do ambiente (ex.: NODE_AUTH_TOKEN)
# só existem dentro da sessão. Localmente (Windows/Mac) não faz nada.
# Copie para <repo>/.claude/hooks/session-start.sh e registre em <repo>/.claude/settings.json.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
LOG=/tmp/cloud-setup.log
if bash scripts/cloud-setup.sh >> "$LOG" 2>&1; then
  grep '^\[cloud-setup\]' "$LOG" | tail -1
else
  # Não bloqueia a sessão: o resumo entra no contexto para a sessão relatar e corrigir.
  echo "[cloud-setup] FALHOU (exit $?). Últimas linhas de $LOG:"
  grep -v -i 'authtoken' "$LOG" | tail -15
fi
exit 0
