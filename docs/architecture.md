# アーキテクチャ

この文書は実装の構造と設計原則を説明する。セットアップ・日常運用(反映の2経路・doctor・掃除)は README、ダッシュボードの設計は dashboard-design.md。語彙は `src/ios/words.ts`(日本語の正式名と英語識別子の 1:1 対訳)が定義で、そこにない語は実装に登場させない。

## 全体

```
Claude Code セッション(対話 / 並列ワーカー / cron)… N 個
 ├── XcodeBuildMCP ──── ビルド・テスト・シミュレータ操作(ゲートは関与しない)
 ├── claude-gate プラグイン ── MCP 接続 + gate-loop スキル + PreToolUse hook(git push 遮断)
 └── claude-gate デーモン(HTTP MCP・127.0.0.1:7350・マシンに1プロセス・launchd 常駐)
       ├─ tools: ping / open_report / register_build / attach_evidence / run_check / judge / submit
       ├─ kernel: store(状態)+ audit(監査)+ api(ダッシュボード読み取りモデル)
       ├─ subprocess: git / xcrun simctl / gate.yaml の checks コマンド
       └─ /(ダッシュボード配信・読み取り専用)
```

設計原則(実装に効いているものだけ):

- **実行は自由、採用は厳格**: ビルドや操作は縛らない。「観測を証拠として受理する」「判定する」「提出する」の瞬間だけ、ゲートが実物を確かめる
- **申告を信用しない**: ビルドID はゲートが .app の中身から計算する。証拠の受理時はシミュレータ内の実物から計算し直して照合する。テスト系の確かめはエージェントの自己申告ではなく、ゲート自身が gate.yaml 宣言のコマンドを実行する(run_check)
- **実機は Mach-O UUID で照合する**: 実機からは .app を取り出せない(コンテナが取れない)ので中身ハッシュでは照合できない。代わりに register_build 時に実行バイナリの LC_UUID を記録し、実機で走ったアプリが自分の LC_UUID を print したセルフレポート(device_report・`buildUUID=` 行)をその集合と照合する。keychain 復元・課金・通知配信・上書き更新 E2E など実機でしか検証できない動作の正式な証拠経路
- **判定は決定論**: judge は pure function(報告 + 証拠 + builds + gate.yaml + 見えないこと台帳 → 判定)。LLM なし。ゴールデンテストで固定
- **全操作べき等**: ID は乱数ではなく中身・対象から決める。同じ呼び出しを2回しても状態は1つ。再実行・リトライ・スケジュール実行が安全
- **セッション状態を持たない**: 全ツールが対象(worksitePath 等)を明示引数で受ける。並列で何セッション繋がっても混線しない
- **silent fallback 禁止**: 失敗は必ず rejected(reason + fix)として表面化する
- **掃除はエージェントの語彙に入れない**: 記録の削除は人間の CLI(`claude-gate forget`)のみ。参照されている記録は消せず、レコード単位の削除は監査ログに残る

## コード構成

```
src/
  cli.ts             # claude-gate CLI(serve / install / doctor / init / forget)。launchd plist を動的生成
  kernel/            # ドメイン非依存の薄い機構
    server.ts        # HTTP MCP(stateless streamable)+ ダッシュボード API/配信。ツール登録
    store.ts         # 状態の置き場の解決と JSON 読み書き
    audit.ts         # events.jsonl への追記
    api.ts           # ダッシュボードの読み取りモデル(overview / repoDetail / 証拠ファイル)
    forget.ts        # 掃除の本体(参照チェック・べき等・監査記録)
  ios/               # iOS ドメイン
    words.ts         # 語彙の型定義(日本語の正式名と 1:1。ここにない語は使わない)
    build_id.ts      # .app ディレクトリ → ビルドID(決定論・純関数)
    macho_uuid.ts    # 実行バイナリの LC_UUID 抽出(dwarfdump)+ セルフレポートの buildUUID 照合(実機の出所照合)
    simulator.ts     # simctl get_app_container
    git.ts           # rev-parse / status(sha・dirty・repoKey の解決)
    gate_yaml.ts     # リポジトリ内 gate.yaml の読み取りと検証(壊れた宣言は rejected)
    gate_init.ts     # gate.yaml 雛形の生成(claude-gate init)
    defaults.ts      # 同梱デフォルト(passline・見えないこと台帳)
    judge_core.ts    # 判定のコア(全入力を引数で受ける pure function)
    report_link.ts   # 証拠と報告の紐づけ + FSM の移動(判定後の証拠追加で判定を無効化)
    tools/           # MCP ツールの本体(open_report / register_build / attach_evidence /
                     #   run_check / judge / submit)
dashboard/           # React ダッシュボード(HeroUI v3 + Tailwind v4。設計 = docs/dashboard-design.md)
hooks/               # PreToolUse hook(guard-push.sh: gate.yaml のあるリポでエージェントの git push を遮断)
skills/gate-loop/    # 使い方スキル(いつ・どの順でツールを呼ぶか)
.claude-plugin/      # Claude Code プラグイン定義(バージョンはデーモンと独立)
.mcp.json            # プラグインの MCP 接続定義(→ http://127.0.0.1:7350/mcp)
```

## データ

```
~/.claude-gate/
  repos.json               # 既知リポジトリの台帳
  repos/<repoKey>/         # repoKey = git 共有ディレクトリの実パスの sha256 先頭12文字
    builds/<buildId>.json    # 中身ハッシュ・gitSha/dirty・Mach-O UUID(machoUuids: 実機照合用)
    evidence/<evidenceId>.json + 観測ファイル・実行ログ・実機レポートの不変コピー
    reports/<reportId>.json  # 完了報告(状態・動作一覧・紐づけ・判定結果・提出の記録)
    events.jsonl           # 監査(成功も拒否も掃除も全部)
  logs/                    # デーモンのログ
```

- repoKey は全 worktree から同じ値に解決される(worktree を消しても状態が残る)
- 証拠ファイルは受理時にコピーして不変化する(元ファイルが上書きされても証拠は変わらない)
- 宣言(env / worksite / checks / passline / cannot_see)は状態と分離し、リポジトリ内の `gate.yaml`(git 管理)に置く

## ツール表面

全ツールの引数・拒否条件は `src/kernel/server.ts` の登録定義と各 tools/ 実装が正。応答の封筒は共通:

```ts
{ status: "ok"; state: …; note?: string; nextSteps: string[] }
| { status: "rejected"; reason: string; fix: string; nextSteps: string[] }
```

rejected は「何がダメか(reason)」と「どうすれば通るか(fix)」を必ず持つ。fix は「従えば必ず通る」ことを実運用で確かめてから書く。

完了報告の FSM(全状態が実運用済み):

```
下書き → 証拠あり → 合格 / 不合格 / 確認できず → 提出済み(終着)
```

## テスト

`npm test`(vitest・85本)+ `npm run typecheck`(server + dashboard)。CI は GitHub Actions(push/PR で typecheck + vitest)。

- 中心は **A1 再現テスト**(attach_evidence: 古いビルドのスクショは拒否される)と **judge のゴールデンテスト**(入力組合せ → 期待判定。「覆いは動作ごとに最新の適合証拠1件」— 証拠の積み上がりが同一ソース要件を永久に破る回帰を含む)
- **実機レポート**は照合ロジックを分けてテスト: dwarfdump 出力・セルフレポートの UUID パース(`macho_uuid.test.ts`・実バイナリ非依存)と、attach_evidence(device_report)の受理/拒否(`device_report.test.ts`・register_build に UUID を注入)
- submit はローカル bare リモートへの実 push で検証(全拒否経路 + べき等)
