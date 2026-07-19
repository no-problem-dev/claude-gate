#!/bin/bash
# ゲート運用リポジトリ(gate.yaml あり)でのエージェントの git push を遮断する。
# 入口の構造化(お願いではなく決定論): 提出はゲートの submit に一本化する。
# - スコープ: gate.yaml をルートに置いたリポジトリだけ(宣言と強制が一致。他リポは素通し)
# - 縛るのはエージェントのツール実行だけ。人間がターミナルから push する自由はそのまま
# - 判定できないときは通す(このスクリプトの失敗で無関係な作業を壊さない)
set -u

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$COMMAND" ] || exit 0

# git push を含まないコマンドは対象外
printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+([^[:space:]]+[[:space:]]+)*push([[:space:]]|$)' || exit 0

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# push が実行されうるディレクトリの候補: git -C <path> / cd <path> / セッションの cwd
CANDIDATES=()
C_PATH=$(printf '%s' "$COMMAND" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+).*/\1/p' | head -1)
[ -n "$C_PATH" ] && CANDIDATES+=("$C_PATH")
CD_PATH=$(printf '%s' "$COMMAND" | sed -nE 's/.*(^|[;&|[:space:]])cd[[:space:]]+([^[:space:];&|]+).*/\2/p' | head -1)
[ -n "$CD_PATH" ] && CANDIDATES+=("$CD_PATH")
[ -n "$CWD" ] && CANDIDATES+=("$CWD")

for DIR in "${CANDIDATES[@]}"; do
  DIR="${DIR/#\~/$HOME}"
  [ -d "$DIR" ] || continue
  ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || continue
  if [ -f "$ROOT/gate.yaml" ]; then
    echo "このリポジトリ($ROOT)はゲート運用(gate.yaml あり)。エージェントの git push は使えない — 提出は gate の submit で行う(合格した報告と、検証したソース == HEAD の照合を通ったものだけが push される)。報告が未判定なら judge、未合格なら証拠を集め直す。人間がターミナルから push するのは自由。" >&2
    exit 2
  fi
done

exit 0
