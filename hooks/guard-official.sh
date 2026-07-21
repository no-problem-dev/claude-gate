#!/bin/bash
# ゲート運用リポジトリ(gate.yaml あり)で、作業を「公式化」する操作だけを遮断する。
# 境界線(src/ios/words.ts): 共有(feature ブランチへの push・下書きPR の作成)は自由 /
# 提出(ドラフト解除)はゲートの submit だけ / 取り込み(merge)は人間だけ。
# - この hook は入口の誘導であって壁ではない(パターン照合は破れる)。破れない壁は
#   GitHub 側のデフォルトブランチ保護に置く(docs/architecture.md)
# - スコープ: gate.yaml をルートに置いたリポジトリだけ(宣言と強制が一致。他リポは素通し)
# - 縛るのはエージェントのツール実行だけ。人間がターミナルから操作する自由はそのまま
# - 判定できないときは通す(このスクリプトの失敗で無関係な作業を壊さない)
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
  deny "このリポジトリ($ROOT)はゲート運用。取り込み(merge)は人間だけの操作 — エージェントは PR をマージできない。合格した報告を submit でレビュー可能にし、取り込みは人間に依頼する。"
fi
if has '(^|[;&|[:space:]])gh[[:space:]]+api[[:space:]]' && has '(pulls/[^[:space:]]*/merge|mergePullRequest|enablePullRequestAutoMerge)'; then
  deny "このリポジトリ($ROOT)はゲート運用。API 経由の取り込み(merge)も人間だけの操作 — 合格した報告を submit でレビュー可能にし、取り込みは人間に依頼する。"
fi

# --- 提出(ドラフト解除)はゲートの submit だけ ---
if has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+ready([[:space:]]|$)' || has 'markPullRequestReadyForReview'; then
  deny "このリポジトリ($ROOT)はゲート運用。ドラフト解除(提出)は gate の submit で行う — 合格した報告の、検証したソース = HEAD = PR 先頭の照合を通ったものだけがレビュー可能になる。報告が未判定なら judge、未合格なら証拠を集め直す。人間がターミナルから操作する自由はそのまま。"
fi

# --- PR の作成は下書きだけ(レビュー依頼が飛ぶ非ドラフト作成は提出と同じ公式化) ---
if has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
  if ! has '(^|[[:space:]])(--draft|-d)([[:space:]]|$|=)'; then
    deny "このリポジトリ($ROOT)はゲート運用。PR は --draft を付けて下書きで作る(共有は自由)。レビュー依頼(ドラフト解除)は合格した報告の submit だけが行える。"
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
        deny "このリポジトリ($ROOT)はゲート運用。デフォルトブランチ($DST)への直接 push は取り込み相当 — エージェントは行えない。feature ブランチへ push して下書きPR を作り(共有は自由)、合格した報告を submit でレビュー可能にする。取り込みは人間に依頼する。"
      fi
    done
  done
fi

exit 0
