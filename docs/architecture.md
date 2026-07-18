# アーキテクチャ

このリポジトリは実装。概念設計(ドメインモデル・対訳表・あってはいけない状態の一覧)の SSOT は life リポジトリの `os/write/ios-*.md` 群にあり、ここでは実装の構造だけを説明する。

## 全体

```
Claude Code セッション(対話 / 並列ワーカー / cron)… N 個
 ├── XcodeBuildMCP ──── ビルド・テスト・シミュレータ操作(ゲートは関与しない)
 └── claude-gate デーモン(HTTP MCP・127.0.0.1:7350・マシンに1プロセス)
       ├─ tools: ping / register_build / attach_evidence
       ├─ kernel: store(状態)+ audit(監査)— 単一プロセスなので書き込みは直列
       └─ subprocess: git / xcrun simctl
```

設計原則(実装に効いているものだけ):

- **実行は自由、採用は厳格**: ビルドや操作は縛らない。「観測を証拠として受理する」瞬間だけ、ゲートが実物を確かめる
- **申告を信用しない**: ビルドID はゲートが .app の中身から計算する。証拠の受理時はシミュレータ内の実物から計算し直して照合する
- **全操作べき等**: ID は乱数ではなく中身・対象から決める。同じ呼び出しを2回しても状態は1つ。再実行・リトライ・スケジュール実行が安全
- **セッション状態を持たない**: 全ツールが対象(worksitePath 等)を明示引数で受ける。並列で何セッション繋がっても混線しない
- **silent fallback 禁止**: 失敗は必ず rejected(reason + fix)として表面化する

## コード構成

```
src/
  cli.ts             # claude-gate CLI(serve / install / doctor)。launchd plist を動的生成
  kernel/            # ドメイン非依存の薄い機構
    server.ts        # HTTP MCP(stateless streamable)。ツール登録
    store.ts         # 状態の置き場の解決と JSON 読み書き
    audit.ts         # events.jsonl への追記
  ios/               # iOS ドメイン
    words.ts         # 語彙の型定義(life リポジトリの対訳表と 1:1。表にない語は使わない)
    build_id.ts      # .app ディレクトリ → ビルドID(決定論・純関数)
    simulator.ts     # simctl get_app_container
    tools/           # MCP ツールの本体(register_build / attach_evidence)
```

## データ

```
~/.claude-gate/
  repos.json               # 既知リポジトリの台帳
  repos/<repoKey>/         # repoKey = git 共有ディレクトリの実パスの sha256 先頭12文字
    builds/<buildId>.json
    evidence/<evidenceId>.json + 観測ファイルの不変コピー
    events.jsonl           # 監査(成功も拒否も全部)
  logs/
```

- repoKey は全 worktree から同じ値に解決される(worktree を消しても状態が残る)
- 証拠ファイルは受理時にコピーして不変化する(元ファイルが上書きされても証拠は変わらない)

## ツール仕様(スライス1)

### register_build

| 引数 | 意味 |
|---|---|
| worksitePath | 作業場(worktree)のパス。状態の置き場をここから解決 |
| appPath | ビルド成果物 .app(XcodeBuildMCP の `data.artifacts.appPath`) |
| scheme / configuration | 記録用メタ(任意) |

.app の全ファイルを相対パスでソートし、パス + 中身のハッシュから buildId を計算(git の commit ID と同じ仕組み)。同じビルドの再登録は同じレコードを返す。

### attach_evidence

| 引数 | 意味 |
|---|---|
| worksitePath / buildId | どの作業場・どのビルドについての証拠か |
| kind | screenshot / ui_snapshot / video |
| file | 観測ファイルのパス |
| simulatorUdid / bundleId | どのシミュレータの・どのアプリを観測したか |
| note | 何を観測したか(任意) |

受理前に `simctl get_app_container` でシミュレータ内の実物を取得し、ビルドID を計算し直して登録済みの ID と照合する。不一致は rejected(両方の ID と直し方を返す)。evidenceId = sha256(buildIdFull + kind + ファイル内容) の先頭12文字なので、同じ証拠の再添付は何も増やさない。

### 応答の型(全ツール共通)

```ts
{ status: "ok"; state: …; nextSteps: string[] }
| { status: "rejected"; reason: string; fix: string; nextSteps: string[] }
```

rejected は「何がダメか(reason)」と「どうすれば通るか(fix)」を必ず持つ。エージェントは fix に従って直し、nextSteps で次の操作を知る。

## テスト

`npm test`(vitest・11本)。中心は **A1 再現テスト**: 「シミュレータに古いビルドが残った状態で撮ったスクショは拒否される」— 実際に起きた事故の再現が最重要の受け入れ基準。

## 今後(スライス2〜4)

完了報告(open_report)と判定(judge)・合格ライン YAML・変更の種類ごとの最低限の確かめ方(minimum_check)・専用シミュレータの割り当て・担当(claim)・提出(submit)の一本化・React ダッシュボード。設計は life リポジトリの `os/write/ios-gate-spec.md` / `ios-parallel.md`。
