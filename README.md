# claude-gate

AI との iOS 開発で、エージェントの「できました」に証拠を義務づけ、証拠の出所を機械で確かめ、確かめられたものだけを提出するためのゲート。マシンに1つ常駐するローカル MCP サーバ(HTTP・127.0.0.1:7350)+ 人間向けダッシュボード。

このリポジトリに実行実体のすべてが入っている:

| 層 | 場所 | 内容 |
|---|---|---|
| デーモン | `src/` → `dist/` | HTTP MCP サーバ + 読み取り API + CLI(`claude-gate`) |
| ダッシュボード | `dashboard/` | 人間向けの状態表示(React)。デーモンが `/` で配信 |
| Claude Code プラグイン | `.claude-plugin/` + `.mcp.json` + `skills/` | gate MCP 接続定義 + gate-loop スキル(使い方の規定) |

設計文書の SSOT は life リポジトリの `os/write/`:

- `ios-domain-model.md` — ドメインモデル(完了報告と証拠・**対訳表 = 語彙の SSOT**)
- `ios-task-loop.md` — タスク一枚のループ(変更の種類 → 最低限の確かめ方)
- `ios-gate-implementation.md` — 実装方針(素通し / 採用時に確かめる / ゲートのみ)
- `ios-parallel.md` — 並列と冪等(デーモン1台・全操作べき等)
- `ios-gate-spec.md` / `ios-gate-spec2.md` / `ios-gate-spec3.md` — スライス1〜3の実装仕様
- `ios-gate-distribution.md` — 配布3層(npm / プラグイン / ローカルデータ)
- `ios-dogfood-notes.md` — ドッグフード観察の台帳(改善は全部ここから)

## いま出来ること(スライス1〜3 稼働中)

完了報告の一生(下書き → 証拠あり → 合格/不合格/確認できず → 提出済み)が全部ゲートを通る:

| ツール | 内容 |
|---|---|
| `ping` | 生存確認 |
| `open_report` | 報告を開く。作業名 + 動作一覧(動作 × 変更の種類 × 確かめ方)を宣言。空の一覧・合格ライン未満の計画は開けない |
| `register_build` | ビルドを登録する。`.app` の中身からビルドID を計算(git の commit ID と同じ仕組み) |
| `attach_evidence` | 証拠を付ける。受理前にシミュレータ内の実物と ID 照合し、別のビルドなら拒否する |
| `run_check` | 確かめを実行する。gate.yaml の checks 宣言コマンドをゲート自身が実行し、終了コード + ログを証拠化(テストの自己申告を排除) |
| `judge` | 判定する。決定論で 合格/不合格/確認できず(動作ごとの理由つき)。見えないこと台帳・同一ビルド/同一ソース要件込み |
| `submit` | 提出する。合格 + 検証したソース == HEAD を照合して `git push origin HEAD`(PR 作成は未実装) |

掃除は人間の CLI(`claude-gate forget`)。エージェントの語彙(MCP)には「記録を消す」を入れない。

リポジトリ側の宣言はルートの `gate.yaml`(env / worksite / checks / passline / cannot_see。全セクション任意)。

ダッシュボード(http://127.0.0.1:7350/)は全リポジトリ横断で、完了報告(カバレッジ表・判定・提出)・ビルド・証拠・できごとを一覧する。読み取り専用: 状態を変えられるのは MCP ツールだけ。

## セットアップ(初回だけ)

**マシン側**(このリポジトリで):

```bash
npm install && npm run build && npm link   # claude-gate コマンドを PATH へ
claude-gate install                        # launchd 常駐 + 稼働確認
```

**Claude Code 側**(どこからでも・user スコープ):

```bash
claude plugin install claude-gate@taniguchi-kyoichi
```

これで全ディレクトリ・全セッションで gate ツールと gate-loop スキルが使える。プロジェクト側に置くファイルはゼロ。

## 再起動したら

**何もしなくてよい。** launchd(`RunAtLoad` + `KeepAlive`)がログイン時にデーモンを自動起動する。調子が悪いときだけ:

```bash
claude-gate doctor    # launchd / デーモン / ダッシュボード / プラグインを一括点検(直し方も出る)
claude-gate install   # 直すのはこれ一発(べき等)
```

コードを更新したときは `npm run build && claude-gate install` で反映する。

## データの場所

ローカルデータは `~/.claude-gate/` に置く(普通のアプリと同じ):

```
~/.claude-gate/
  repos.json               # 既知リポジトリの台帳
  repos/<repoKey>/         # リポジトリごとの状態(repoKey = git 共有ディレクトリの実パスのハッシュ)
    builds/  evidence/  events.jsonl
  logs/
```

リポジトリの同定は git 共有ディレクトリの実パスで行うため、worktree をいくつ作って消しても状態は同じ場所に残る。
