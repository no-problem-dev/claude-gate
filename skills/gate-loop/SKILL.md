---
name: gate-loop
description: >
  iOS 実装・修正タスクで、動作や見た目を確認して「できました」と報告するときの手順。
  ビルドを登録し、スクショ・録画を証拠としてゲートに受理させてから報告する。
  「動作確認」「スクショで確認」「QA」「直りました」「できました」の場面で自動適用。
user-invocable: true
---

# gate-loop — 証拠つきの完了報告

## 前提

- ローカルに claude-gate デーモンが常駐していること(gate MCP の `ping` で確認。応答がなければユーザーに `claude-gate install` を依頼)
- gate のツール実名は導入経路で変わる(プラグイン経由なら `mcp__plugin_claude-gate_gate__*`、直接接続なら `mcp__gate__*`)。以下では `register_build` 等のツール名だけで書く
- ゲート本体を更新した直後(ツールの追加・引数の変更)は、MCP ツール一覧が古いままのことがある。**`/mcp reconnect <サーバー名>` をユーザーに依頼して再接続すればその場で一覧が更新される**(セッションの開き直しは不要)。スキルを更新した場合は `/reload-plugins`
- ビルド・シミュレータ操作は XcodeBuildMCP をそのまま使う(ゲートは実行を縛らない)
- 状態は http://127.0.0.1:7350 のダッシュボードで人間も見ている。受理・拒否はすべて記録される

## 原則

**ゲートが受理した観測だけが「確認した」の根拠になる。** 受理されていないスクショ・録画をもとに「確認しました」「直りました」と報告してはならない。スクショで何かを確かめたつもりでも、シミュレータに古いビルドが残っていれば、見ているのは別物の画面である(実際に起きた事故)。ゲートはこれを ID 照合で機械的に検出する。

## STEPS

### -1. 作業前にリポジトリの gate.yaml を読む

リポジトリのルートに `gate.yaml` があれば、作業前に読む。`env`(検証環境の前提: 依存サービス・起動引数)と `worksite`(作業場を開く手順: xcodegen generate 等)はここに宣言されている。無ければデフォルトのままで動く。

**テスト生成物が gitignore されているか確認する**(`.deriveddata/` や SPM の `.build/` 等)。追跡されたままだと run_check の実行が作業場を汚し、以後のビルド登録が全部 dirty になる(実際に起きた)。

### 0. 作業を始めたら報告を開く

作業1つにつき、最初に報告を開いて「何が動くと言うつもりか」を宣言する:

```
open_report(
  worksitePath: <今の worktree のルート>,
  title: <作業名(日本語の日常語。例「時間帯あいさつ+日付表示」)>,
  behaviors: [
    { behavior: <動くと言っている動作(文で書く)>,
      change_kind: <変更の種類(語彙から選ぶ)>,
      check: <使う確かめ方(語彙から選ぶ)> },
    ...
  ]
)
→ reportId と、動作の番号(1始まり)が返る
```

変更の種類の語彙:
`logic`(ロジック)/ `appearance`(見た目)/ `interaction`(操作・遷移)/ `motion`(動き)/ `data`(データ)/ `contract`(契約)/ `config`(設定)/ `system`(連携)

確かめ方の語彙(これ以外は拒否される):
`compile`(コンパイル)/ `unit_test`(ユニットテスト)/ `screenshot`(スクショ)/ `interaction_log`(操作記録)/ `ui_test`(UIテスト)/ `video`(録画)/ `launch_check`(起動確認)/ `device_report`(実機レポート)/ `human_check`(人間確認)

`device_report` は、**実機でしか検証できない動作**(keychain 復元・StoreKit 課金・プッシュ通知配信・上書きアップデート E2E 等)のための確かめ方。実機で走ったアプリ自身が状態を print したセルフレポートを証拠にする(手順 3c)。シミュレータでは成立しない検証(見えないこと台帳に載っている課金・通知等)も、実機のセルフレポートなら覆える。

- **動作一覧が空の報告は開けない**(証拠なしの「できました」を型で防ぐ)
- **確かめ方には下限がある**: 変更の種類ごとに使ってよい確かめ方が決まっていて(例: 操作・遷移に静的スクショは不可)、下回る計画は開けない。拒否の fix に使える確かめ方が列挙される。下限を下げる例外は人間が gate.yaml の `passline` を変更する(git に記録が残る)— エージェントが勝手に変更しない
- **動作は正直に書く**: 「〜できる」という操作の動作なら change_kind は `interaction`。静的スクショで覆いたいからと「〜が表示される」に宣言の側を弱めない(実際に起きた過ち)。状態の表示を確かめたいなら、最初からそう書く
- 動作一覧はオープン時に固定。増やしたくなったら別の作業名で開き直す
- 同じ作業名の再呼び出しはべき等(既存の報告が返る)

### 1. コミットしてからビルドする

証拠にするビルドは**コミット → ビルド → 登録**の順で作る。未コミットの状態からビルドすると、記録に `dirty: true` が残り、どのソースの証拠か曖昧になる。ループ中の試行錯誤ビルドは自由(登録しなければ記録されない)。

### 2. ビルドしたら登録する

XcodeBuildMCP でビルドしたら、成果物のパス(structured output の `data.artifacts.appPath`、旧版なら `get_sim_app_path`)を使って:

```
register_build(
  worksitePath: <今の worktree のルート>,
  appPath: <.app のパス>,
  scheme: <スキーム名>
)
→ buildId が返る。以後の証拠はこの buildId に紐づける
```

### 3. 観測したら証拠にする

**添付の前に、観測ファイルの中身を自分の目で確認する。** スクショに写っているのがスケルトン画面や読み込み失敗画面なら、それは対象の動作の証拠ではない(実際にあった)。確認すべき動作が画面に写っていることを確かめ、`note` に「何が写っているか」を書いてから添付する。

アプリの検証には環境の前提があることが多い(例: Debug ビルドはローカル API サーバー必須、`--screenshot-*` 起動引数で認証スキップ + 固定データ表示)。プロジェクトの README / AGENTS.md / 設定を先に確認する。

スクショ・録画・UI スナップショットを確認の根拠にするときは、必ず:

```
attach_evidence(
  worksitePath: <同上>,
  buildId: <手順2の buildId>,
  kind: "screenshot" | "ui_snapshot" | "video",
  file: <観測ファイルのパス>,
  simulatorUdid: <観測したシミュレータの UDID>,
  bundleId: <対象アプリの bundle ID>,
  note: <何を観測したか>,
  reportId: <手順0の reportId>,
  behaviorIndex: <この観測が確かめる動作の番号(1始まり)>
)
```

reportId と behaviorIndex は**セットで**付ける(どの動作の証拠かを宣言する)。報告に属さない一時的な観測なら両方省略できるが、作業の証拠は原則すべて報告に紐づける。

ゲートはシミュレータ内の実物アプリからビルドID を計算し直し、登録した ID と照合してから受理する。

### 3c. 実機でしか確かめられない動作は実機レポートで証拠にする

keychain 復元・StoreKit 課金・プッシュ通知配信・上書きアップデートの E2E は、シミュレータでは成立しない。実機に入れたアプリ自身に状態を print させ、その console 出力を証拠にする(`check: device_report` で宣言した動作向け):

1. **アプリに自己報告を仕込む**: 起動時などに、自分の Mach-O UUID と検証したい状態を print する。UUID は出所照合に使うので**必ず** `buildUUID=<uuid>` の形で出す。`#dsohandle` を使うのが要点 — Xcode 16+ の Debug ビルドは実コードを `<App>.debug.dylib` に置き、メイン実行ファイルはビルド間で不変のスタブになる。`#dsohandle` は「このコードが載っている image」(Debug では `.debug.dylib`)を指すので、ビルドごとに変わる実コードの UUID を報告できる(`_dyld_get_image_header(0)` でメイン実行ファイルを見ると、内容の違うビルドが同じ UUID になり古いビルドを受理してしまう):

   ```swift
   import MachO
   // dso 既定引数の #dsohandle は呼び出し元(アプリのコード)が載っている image を指す
   func currentBuildUUID(dso: UnsafeRawPointer = #dsohandle) -> String {
       let header = dso.assumingMemoryBound(to: mach_header_64.self)
       var cursor = UnsafeRawPointer(header).advanced(by: MemoryLayout<mach_header_64>.size)
       for _ in 0..<header.pointee.ncmds {
           let cmd = cursor.assumingMemoryBound(to: load_command.self)
           if cmd.pointee.cmd == LC_UUID {
               return UUID(uuid: cursor.assumingMemoryBound(to: uuid_command.self).pointee.uuid).uuidString
           }
           cursor = cursor.advanced(by: Int(cmd.pointee.cmdsize))
       }
       return "unknown"
   }
   print("buildUUID=\(currentBuildUUID())")
   // 続けて検証したい状態も print(例: print("[SPIKE] keychain restored: \(restored)"))
   ```

2. **実機に入れたのと同じ .app を register_build する**(ゲートが実行バイナリの LC_UUID を記録する。ここで登録した .app と実機に install した .app が同じであること)
3. **実機でアプリを起動し、console を回収する**(`xcrun devicectl device process launch --console` 等)。回収したテキストをファイルに保存する
4. **device_report として添付する**:

   ```
   attach_evidence(
     worksitePath: <同上>,
     buildId: <手順2の buildId>,
     kind: "device_report",
     file: <回収した console テキストのパス>,
     deviceUdid: <実機の UDID>,
     bundleId: <対象アプリの bundle ID>,
     note: <何を実機で確かめたか>,
     reportId: <reportId>,
     behaviorIndex: <動作の番号>
   )
   ```

ゲートはレポート本文の `buildUUID=` 行を、登録ビルドの Mach-O UUID と照合してから受理する(実機からは .app を取れないので、中身ハッシュではなく UUID で「同じビルドか」を確かめる)。`buildUUID=` 行が無い・別ビルドの UUID なら拒否される。

### 3b. テスト系の確かめはゲートに実行させる

`compile` / `unit_test` / `ui_test` の確かめは、自分でコマンドを回して「緑でした」と言うのではなく、**ゲートに実行させて証拠化する**:

```
run_check(
  worksitePath: <同上>,
  check: "unit_test",     # compile / unit_test / ui_test
  reportId: <手順0の reportId>,
  behaviorIndex: <動作の番号>
)
```

- 実行コマンドはリポジトリの gate.yaml の `checks` に宣言されている必要がある(無ければ拒否されるので、人間に gate.yaml への宣言を依頼するか、正しいコマンドを調べて gate.yaml に追加してコミットする)
- 終了コードと出力ログがそのまま証拠になる。赤(非0)も事実として記録される — 隠さず直してから実行し直す
- 開発ループ中に自分で `swift test` を回すのは自由(速い確かめ)。**証拠にするのは run_check の実行だけ**

### 4. rejected が返ったら fix に従う

- 「別物」→ 登録したビルドを install し直すか、いま入っているビルドを register_build してから撮り直す
- 「未登録」→ 先に register_build
- **rejected を無視して報告を続けること、照合を回避する手段(ファイルの手動コピー等)は禁止**

### 5. 総確かめの最後に判定させる

全動作に証拠を付けたら、自分で「できました」と判断せず、**ゲートに判定させる**:

```
judge(worksitePath: <同上>, reportId: <手順0の reportId>)
→ 合格 / 不合格 / 確認できず(動作ごとの理由つき)
```

- **合格** → 提出できる(手順6)
- **不合格** → 動作ごとの reason を直し、証拠を集め直してから judge し直す(何度でも可)
- **確認できず** → 失敗ではなく、人間に渡す正式な出口。reason(なぜ機械で確認できないか・代わりの確認手段)を添えてユーザーに確認を依頼する。**OK と言い換えない**
- 判定後に証拠を足すと判定は無効になり 証拠あり に戻る(再 judge が必要)
- 証拠が複数ビルド・複数ソースにまたがると合格しない。**最後のビルドで全証拠を取り直すのが正道**

### 6. 共有は自由、提出はゲートで、取り込みは人間

**共有(feature ブランチへの `git push`・下書きPR の作成 `gh pr create --draft`)は自由領域** — ゲートを通さずいつでもできる(前提: デフォルトブランチは GitHub 側のブランチ保護で守られている)。公式化だけがゲートと人間の領分:

```
submit(worksitePath: <同上>, reportId: <合格した報告>)
→ 検証したソース(judge 時の sha)= HEAD = PR 先頭 の三点照合を通した上で、
  git push origin HEAD + 下書きPR をレビュー可能にする(ドラフト解除)
```

- **検証後にコミットが動いていたら拒否される**(積んだ/戻した)→ いまの HEAD で証拠を取り直して judge → submit し直す
- dirty なソースで検証された報告は提出できない(クリーンで検証し直す)
- **このブランチの PR が無ければ拒否される** → `gh pr create --draft` で下書きPR を作ってから submit し直す
- 提出済みの報告は終着。証拠の追加もできない — 続きは新しい作業名で開く
- **取り込み(マージ)は人間だけの操作**。エージェントは `gh pr ready` / `gh pr merge` / デフォルトブランチへの直接 push / 非ドラフトの PR 作成を行わない(hook が遮断する)— 提出後は人間にレビューと取り込みを依頼する

### 7. nextSteps と note を読む

- 各応答の `nextSteps` が次に可能な操作を示す。迷ったらそれに従う
- `note` が付いていたら読む。「既登録」「既添付」= べき等な再呼び出しで、記録は最初の登録時の事実のまま(再実行は安全、記録は増えない)

## Do / Don't

**Do:**
- 作業のはじめに gate.yaml を読み、open_report で動作一覧(変更の種類 + 確かめ方)を宣言する
- ビルドし直したら register_build し直す(ビルドID はビルドごとに変わる)
- テスト系の証拠は run_check(ゲートが実行)、判定は judge(ゲートが照合)、レビュー依頼は submit(ゲートが照合してドラフト解除)に任せる
- 共有は自由に使う: feature ブランチへの push・下書きPR の作成はゲートを通さなくてよい
- 「確認できず」はそのまま人間に渡す(reason と代わりの確認手段を添えて)
- 拒否も含めて起きたことをそのまま報告する(証拠が受理できなかったなら「確認できていない」と言う)
- 記録の掃除(テスト痕跡・プローブの削除)が必要になったら人間に依頼する(`claude-gate forget` は人間の CLI)

**Don't:**
- 検証しやすい確かめ方に合わせて、動作の宣言の側を弱める(スクショで済ませるための言い換え)
- 下限を回避するために gate.yaml の passline を自分で緩める(それは人間の操作)
- 受理されていない観測を根拠に「確認済み」と報告する。judge を通さずに「合格相当」と自己判定する
- 「確認できず」を OK・完了に言い換える
- rejected の後、原因を直さずに再試行だけ繰り返す
- ゲートを通さずに「見た感じ大丈夫」で済ませる
- ゲートを通さずに公式化する: `gh pr ready`・`gh pr merge`・非ドラフトの PR 作成・デフォルトブランチへの直接 push はしない(提出は submit、取り込みは人間)
