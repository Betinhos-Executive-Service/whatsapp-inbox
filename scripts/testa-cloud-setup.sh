#!/usr/bin/env bash
# Teste do preparo da VM cloud num Linux limpo (WSL, como root): cloud-setup.sh direto (instalação
# limpa), hook SessionStart (2ª execução e resume, PATH no CLAUDE_ENV_FILE), hook fora da nuvem,
# hook com falha, versão do package.json intacta, Electron sem binário e nenhum token nos logs.
# Uso: testa-cloud-setup.sh <repo.tar>  (tar gerado com git ls-files -z | tar --null -T - -cf)
# Pastas com sufixo -whatsapp: outras sessões podem testar no mesmo WSL ao mesmo tempo.
set -u
SRC_TAR="$1"
D=/root/sb-whatsapp
H=/root/sbhome-whatsapp
L=/root/run
rm -rf "$D" "$H" /root/sbfail-whatsapp "${L}"*-whatsapp.log && mkdir -p "$D" "$H"
tar -xf "$SRC_TAR" -C "$D"
cd "$D"
export HOME="$H"
V0="$(grep -m1 '"version"' package.json)"

# O hook grava em /tmp/cloud-setup.log; /tmp privado (tmpfs) para não misturar com outras sessões.
hook() { unshare -m bash -c 'mount -t tmpfs tmpfs /tmp && bash "$0"/.claude/hooks/session-start.sh; e=$?; cp /tmp/cloud-setup.log "$1" 2>/dev/null; exit $e' "$@"; }

bash scripts/cloud-setup.sh > "${L}1-whatsapp.log" 2>&1
echo "direto exit=$? | $(tail -1 "${L}1-whatsapp.log")"
grep -E '^ℹ (tests|pass|fail)' "${L}1-whatsapp.log"

ENVF="$H/env-sessao"
OUT="$(CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$D" CLAUDE_ENV_FILE="$ENVF" hook "$D" "${L}2-whatsapp.log")"
echo "hook exit=$? | $(echo "$OUT" | tail -1)"
OUT="$(CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$D" CLAUDE_ENV_FILE="$ENVF" hook "$D" "${L}3-whatsapp.log")"
echo "hook resume exit=$? | $(echo "$OUT" | tail -1)"
echo "PATH no env da sessão: $(grep -c 'export PATH=.*node' "$ENVF") linha(s) | $(bash -c ". $ENVF; node -v; pnpm -v" 2>&1 | tr '\n' ' ')"

OUT="$(unset CLAUDE_CODE_REMOTE; CLAUDE_PROJECT_DIR="$D" hook "$D" /dev/null)"
echo "hook fora da nuvem exit=$? | saída: '${OUT}'"

F=/root/sbfail-whatsapp
mkdir -p "$F/scripts" "$F/.claude/hooks" && cp .claude/hooks/session-start.sh "$F/.claude/hooks/"
printf 'echo "passo quebrado"; exit 3\n' > "$F/scripts/cloud-setup.sh"
OUT="$(CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$F" hook "$F" "${L}4-whatsapp.log")"
echo "hook com falha exit=$? | $(echo "$OUT" | head -1)"

echo "versão do package.json intacta: $([ "$V0" = "$(grep -m1 '"version"' package.json)" ] && echo sim || echo NÃO)"
echo "binário do Electron baixado: $([ -d node_modules/electron/dist ] && echo SIM || echo não)"
echo "token vazado nos logs: $(cat ${L}*-whatsapp.log | grep -c 'gh[pous]_')"
