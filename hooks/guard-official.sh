#!/bin/bash
# ゲート運用リポジトリ(gate.yaml あり)で、取り込みに向かう操作をガードする消費者。
# 境界線(src/ios/words.ts): 共有(feature ブランチへの push・下書きPR の作成)は自由 /
# 提出は記録(ゲートの submit。世界への実行を含まない)/ 取り込みに向かう操作は提出の記録に依存する:
# - レビュー可能化(gh pr ready)は、対象ブランチ先端の sha に一致する提出済みの報告があるかを
#   デーモンに照会し、一致すれば通す(エージェント自身が実行する)。照会できないときは遮断側に倒す
#   (公式化は止めても壊れない操作。「判定できないときは通す」は無関係な作業を壊さないための原則で、
#   公式化そのものには当てはめない)
# - merge・デフォルトブランチへの直接 push・非ドラフト PR 作成は常に遮断(人間だけ)
# - この hook は入口の誘導であって壁ではない(パターン照合は破れる)。破れない壁は
#   GitHub 側のデフォルトブランチ保護と人間の merge に置く(docs/architecture.md)
# - スコープ: gate.yaml をルートに置いたリポジトリだけ(宣言と強制が一致。他リポは素通し)
# - 縛るのはエージェントのツール実行だけ。人間がターミナルから操作する自由はそのまま
set -u

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$COMMAND" ] || exit 0

# git / gh を含まないコマンドは対象外
printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])(git|gh)[[:space:]]' || exit 0

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# 実行されうるディレクトリの候補: git -C <path> / cd <path> / セッションの cwd
CANDIDATES=()
C_PATH=$(printf '%s' "$COMMAND" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+).*/\1/p' | head -1)
[ -n "$C_PATH" ] && CANDIDATES+=("$C_PATH")
CD_PATH=$(printf '%s' "$COMMAND" | sed -nE 's/.*(^|[;&|[:space:]])cd[[:space:]]+([^[:space:];&|]+).*/\2/p' | head -1)
[ -n "$CD_PATH" ] && CANDIDATES+=("$CD_PATH")
[ -n "$CWD" ] && CANDIDATES+=("$CWD")
[ ${#CANDIDATES[@]} -gt 0 ] || exit 0

ROOT=""
WORKDIR=""
for DIR in "${CANDIDATES[@]}"; do
  DIR="${DIR/#\~/$HOME}"
  [ -d "$DIR" ] || continue
  R=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || continue
  if [ -f "$R/gate.yaml" ]; then
    ROOT="$R"
    WORKDIR="$DIR"
    break
  fi
done
[ -n "$ROOT" ] || exit 0 # ゲート運用リポジトリでなければ素通し

deny() {
  echo "$1" >&2
  exit 2
}

has() { printf '%s' "$COMMAND" | grep -qE "$1"; }

# --- 取り込み(merge)は人間だけ(エージェントの語彙に無い操作) ---
if has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
  deny "このリポジトリ($ROOT)はゲート運用。取り込み(merge)は人間だけの操作 — エージェントは PR をマージできない。submit で提出を記録し、取り込みは人間に依頼する。"
fi
if has '(^|[;&|[:space:]])gh[[:space:]]+api[[:space:]]' && has '(pulls/[^[:space:]]*/merge|mergePullRequest|enablePullRequestAutoMerge)'; then
  deny "このリポジトリ($ROOT)はゲート運用。API 経由の取り込み(merge)も人間だけの操作 — submit で提出を記録し、取り込みは人間に依頼する。"
fi

# --- レビュー可能化(gh pr ready)は提出の記録との照合で通す/遮断する(消費者のガード) ---
if has 'markPullRequestReadyForReview'; then
  deny "このリポジトリ($ROOT)はゲート運用。API 経由のレビュー可能化は対象ブランチを判定できない — gh pr ready をブランチ名指定(または対象ブランチをチェックアウトして引数なし)で使う。"
fi
if has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+ready([[:space:]]|$)'; then
  # 対象ブランチの解決: 引数なし = チェックアウト中のブランチ / ブランチ名。番号・URL は先端を解決できない
  READY_ARG=$(printf '%s' "$COMMAND" |
    sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+ready[[:space:]]*//p' | sed -E 's/[;&|].*$//' |
    awk '{for(i=1;i<=NF;i++){if($i !~ /^-/){print $i; exit}}}')
  if printf '%s' "${READY_ARG}" | grep -qE '^[0-9]+$|^https?://'; then
    deny "このリポジトリ($ROOT)はゲート運用。PR 番号・URL では対象ブランチの先端を解決できない — gh pr ready <ブランチ名> か、対象ブランチをチェックアウトして引数なしで実行する。"
  fi
  READY_BRANCH="${READY_ARG:-$(git -C "$WORKDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)}"
  [ -n "${READY_BRANCH}" ] || deny "このリポジトリ($ROOT)はゲート運用。レビュー可能化の対象ブランチを解決できない。"
  READY_SHA=$(git -C "$WORKDIR" rev-parse --verify "refs/heads/${READY_BRANCH}^{commit}" 2>/dev/null || true)
  [ -n "${READY_SHA}" ] || deny "このリポジトリ($ROOT)はゲート運用。ブランチ「${READY_BRANCH}」の先端を解決できない(ローカルにブランチがあるか確認する)。"
  RESP=$(curl -fsS --max-time 3 --get \
    --data-urlencode "path=$WORKDIR" --data-urlencode "sha=${READY_SHA}" \
    "http://127.0.0.1:${GATE_PORT:-7350}/api/submitted" 2>/dev/null) ||
    deny "このリポジトリ($ROOT)はゲート運用。ゲートのデーモンに照会できない(レビュー可能化は提出の記録との照合が必要)— claude-gate doctor でデーモンを確認する。"
  if [ "$(printf '%s' "$RESP" | jq -r '.submitted' 2>/dev/null)" = "true" ]; then
    exit 0 # ブランチ先端が提出済みの報告と一致 — レビュー可能化はエージェント自身が行ってよい
  fi
  deny "このリポジトリ($ROOT)はゲート運用。ブランチ「${READY_BRANCH}」の先端($(printf '%s' "${READY_SHA}" | cut -c1-7))に一致する提出済みの報告が無い — judge で合格させ、submit で提出を記録してから gh pr ready を実行する。"
fi

# --- PR の作成は下書きだけ(レビュー依頼が飛ぶ非ドラフト作成はレビュー可能化と同じ) ---
if has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
  if ! has '(^|[[:space:]])(--draft|-d)([[:space:]]|$|=)'; then
    deny "このリポジトリ($ROOT)はゲート運用。PR は --draft を付けて下書きで作る(共有は自由)。レビュー可能化は submit で提出を記録してから gh pr ready で行う。"
  fi
fi

# --- デフォルトブランチへの直接 push は取り込み相当(feature ブランチへの push は自由) ---
if has '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+([^[:space:]]+[[:space:]]+)*push([[:space:]]|$)'; then
  DEFAULT=$(git -C "$ROOT" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
  # origin/HEAD 未設定なら慣例名で判定する(それでも判定できない refspec は通す)
  DEFAULTS="${DEFAULT:-main master develop}"

  # push 以降・最初のコマンド区切りまでの引数を取り出す
  ARGS=$(printf '%s' "$COMMAND" | sed -nE 's/.*[[:space:]]push([[:space:]]+(.*))?$/\2/p' | sed -E 's/[;&|].*$//')
  REMOTE_SEEN=0
  SKIP_NEXT=0
  DESTS=""
  for W in $ARGS; do
    if [ "$SKIP_NEXT" = 1 ]; then
      SKIP_NEXT=0
      continue
    fi
    case "$W" in
      --repo | --push-option | -o) SKIP_NEXT=1 ;;
      -*) ;; # その他のオプションは refspec ではない
      *)
        if [ "$REMOTE_SEEN" = 0 ]; then
          REMOTE_SEEN=1 # 最初の非オプションは remote 名
        else
          DESTS="$DESTS ${W##*:}" # refspec の宛先(コロンが無ければ全体)
        fi
        ;;
    esac
  done
  # refspec が無い push は現在のブランチに向かう
  if [ -z "${DESTS// /}" ]; then
    DESTS=$(git -C "$WORKDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  fi

  for DST in $DESTS; do
    DST="${DST#+}"
    DST="${DST#refs/heads/}"
    if [ "$DST" = "HEAD" ]; then
      DST=$(git -C "$WORKDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    fi
    [ -n "$DST" ] || continue
    for DEF in $DEFAULTS; do
      if [ "$DST" = "$DEF" ]; then
        deny "このリポジトリ($ROOT)はゲート運用。デフォルトブランチ($DST)への直接 push は取り込み — 人間だけの操作でエージェントは行えない。feature ブランチへ push して下書きPR を作り(共有は自由)、submit で提出を記録する。main 直運用では、人間が提出の記録をダッシュボードで確かめて自分で push する。"
      fi
    done
  done
fi

exit 0
