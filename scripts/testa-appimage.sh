#!/usr/bin/env bash
# Gera o AppImage num Linux (WSL Ubuntu, usuário comum: o Electron recusa rodar como root) e testa
# o pacote: latest-linux.yml, servidor MCP pelo próprio .AppImage e o app de pé por 25 s.
# Uso: testa-appimage.sh <repo.tar>  (tar gerado com git ls-files -co --exclude-standard -z | tar --null -T - -cf)
# Precisa do libfuse2 (sudo apt install libfuse2t64) para montar o AppImage.
set -eu
D="$HOME/appimage-whatsapp"
N="$HOME/.cache/node24-whatsapp"
rm -rf "$D"
mkdir -p "$D"
tar -xf "$1" -C "$D"
cd "$D"
if [ ! -x "$N/bin/node" ]; then
  mkdir -p "$N" && curl -fsSL https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.xz | tar -xJ -C "$N" --strip-components=1
fi
export PATH="$N/bin:$PATH"
corepack pnpm install --frozen-lockfile > "$D/install.log" 2>&1 || { tail -20 "$D/install.log"; exit 1; }
node node_modules/electron/install.js
corepack pnpm exe 2>&1 | grep -E "Build v|Instalador|warn" || true
A="$D/release/WhatsApp-Inbox.AppImage"
test -x "$A" && grep -q "url: WhatsApp-Inbox.AppImage" release/latest-linux.yml && echo "pacote ok: $(du -h "$A" | cut -f1), latest-linux.yml aponta para ele"

export HOME="$D/home" && mkdir -p "$HOME"
MSG='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
s=$(date +%s)
OUT=$(echo "$MSG" | INBOX_MCP_FILE="$HOME/mcp.json" timeout 30 "$A" --mcp-server 2>"$D/mcp-err.log" || true)
echo "$OUT" | grep -q '"serverInfo":{"name":"whatsapp-inbox"' && echo "mcp ok em $(( $(date +%s) - s ))s (encerra ao fechar o stdin)" || { echo "mcp FALHOU: $OUT"; tail -5 "$D/mcp-err.log"; }
# Sem conta pareada o app só mostra o QR; nada é enviado.
set +e
timeout 25 "$A" > "$D/app.log" 2>&1
code=$?
set -e
[ $code -eq 124 ] && echo "app ok: ficou aberto 25 s" || { echo "app FALHOU (exit $code)"; grep -iv "dbus\|gpu\|libva\|viz\|vaapi" "$D/app.log" | tail -10; }
