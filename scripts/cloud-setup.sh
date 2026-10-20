#!/usr/bin/env bash
# Preparo da VM das sessões cloud do Claude Code para o WhatsApp Inbox.
# Quem chama é o hook SessionStart (.claude/hooks/session-start.sh), dentro da sessão.
# Diferenças do modelo genérico: não baixa o binário do Electron (o app desktop não roda na VM),
# reaproveita o Chromium da imagem e termina com typecheck + testes.
# Não usa token nem segredo: sem registro privado, sem .env.local, WhatsApp desligado. Idempotente.
set -euo pipefail
log() { printf '\n[cloud-setup] %s\n' "$*"; }

cd "$(dirname "$0")/.."

# ---------- Node 24 (engines >=24; o servidor roda .ts direto com type stripping) ----------
HAVE="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$HAVE" -lt 24 ]; then
  # Usa o nvm que já existir (a imagem cloud traz um em /opt/nvm); senão instala em ~/.nvm.
  for d in "${NVM_DIR:-}" /opt/nvm "$HOME/.nvm"; do
    if [ -n "$d" ] && [ -s "$d/nvm.sh" ]; then export NVM_DIR="$d"; break; fi
  done
  if [ ! -s "${NVM_DIR:-}/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  if ! nvm use 24 >/dev/null 2>&1; then
    log "Instalando Node 24 (atual: $HAVE)"
    nvm install 24 >/dev/null
  fi
  nvm alias default 24 >/dev/null
fi
log "Node $(node -v)"

# ---------- pnpm pela versão do packageManager ----------
PM="$(node -p 'require("./package.json").packageManager')"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
corepack prepare "$PM" --activate
# A imagem cloud traz outro pnpm no PATH (12.x); neste script, sempre o do packageManager.
pnpm() { corepack pnpm "$@"; }
log "pnpm $(pnpm -v)"

# O shell da sessão não lê ~/.bashrc: o PATH do Node 24 (com o pnpm do corepack) vai pelo arquivo
# de ambiente da sessão. Sem duplicar a linha quando o hook roda de novo (resume).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  LINE="export PATH=\"$(dirname "$(command -v node)"):\$PATH\""
  grep -qxF "$LINE" "$CLAUDE_ENV_FILE" 2>/dev/null || echo "$LINE" >> "$CLAUDE_ENV_FILE"
fi

# Electron e electron-builder só servem para o instalador Windows; pular o download do binário.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile

# ---------- Checagem do código ----------
pnpm typecheck
pnpm test 2>&1 | tail -n 8

# ---------- Chromium headless para a verificar-interface (não bloqueia o setup) ----------
PW_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
# A VM cloud já traz Chromium em $PLAYWRIGHT_BROWSERS_PATH e bloqueia o CDN do Playwright: reaproveita.
if compgen -G "$PW_DIR/chromium*" >/dev/null; then
  CHROMIUM="já instalado"
elif npx -y playwright@1.55.0 install --with-deps chromium \
  || PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx -y playwright@1.55.0 install chromium; then
  CHROMIUM="instalado"
else
  CHROMIUM="FALHOU (verificar-interface indisponível nesta VM)"
  echo "[cloud-setup] AVISO: Chromium não instalado; código e testes seguem ok." >&2
fi

log "Pronto. WhatsApp Inbox: typecheck e testes ok; Chromium: $CHROMIUM. Servidor: WA_DISABLED=1 pnpm dev"
