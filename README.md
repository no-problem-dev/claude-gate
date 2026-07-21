# claude-gate

AI との iOS 開発で、エージェントの「できました」に証拠を義務づけるゲート。

エージェントの作業(実装・ビルド・シミュレータ操作)は縛らない。締めるのは3点だけ:

- **証拠の受理**: 観測(スクショ等)は、シミュレータ内の実物とビルドID を照合して一致したときだけ証拠になる
- **判定**: 宣言した全動作が証拠で覆われているかを、ゲートが決定論で判定する(エージェントは自己判定できない)
- **提出**: 合格した報告の、検証されたそのソース(HEAD = PR 先頭)の下書きPR だけがレビュー可能にできる。共有(feature ブランチへの push・下書きPR の作成)は自由、取り込み(マージ)は人間だけ

完了報告は1本の状態機械で進む: **下書き → 証拠あり → 合格 / 不合格 / 確認できず → 提出済み**。仕組みの説明書はダッシュボードの「ガイド」画面にある。

## 構成

実行実体のすべてがこのリポジトリに入っている:

| 層 | 場所 | 内容 |
|---|---|---|
| デーモン | `src/` → `dist/` | HTTP MCP サーバ(127.0.0.1:7350・マシンに1プロセス)+ CLI(`claude-gate`) |
| ダッシュボード | `dashboard/` | 人間向けの状態表示 + ガイド。デーモンが `/` で配信(読み取り専用) |
| Claude Code プラグイン | `.claude-plugin/` + `.mcp.json` + `skills/` + `hooks/` | MCP 接続定義 + gate-loop スキル + 公式化ガード hook(ドラフト解除・マージ・デフォルトブランチ直 push の遮断) |

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

これで全ディレクトリ・全セッションで gate ツールと gate-loop スキルが使える。プロジェクト側に置くファイルはゼロ。ゲート運用にするリポジトリだけ、ルートに宣言ファイル `gate.yaml`(env / worksite / checks / passline / cannot_see。全セクション任意)を置く。

**新しいリポジトリに導入するとき**は、そのリポジトリのルートで一発:

```bash
claude-gate init    # gate.yaml の雛形を作る(既存なら上書きしない)
```

生成された `checks` のスキーム名・コマンドをリポジトリに合わせて編集し、git に載せる。全セクション任意なので、消せば同梱デフォルトだけで動く。

## 日常の運用

**PC 再起動後は何もしなくてよい**(launchd がログイン時に自動起動)。調子が悪いときだけ:

```bash
claude-gate doctor    # launchd / デーモン / ダッシュボード / プラグインを一括点検(直し方も出る)
claude-gate install   # 直すのはこれ一発(べき等)
```

コードを更新したときの反映は**2経路ある**(片方だけだと効かない):

| 変えたもの | 反映コマンド |
|---|---|
| デーモン・ダッシュボード(`src/` `dashboard/`) | `npm run build && claude-gate install` |
| プラグイン(`skills/` `hooks/` `.mcp.json` `.claude-plugin/`) | plugin.json の version を上げて push → `claude plugin update claude-gate@taniguchi-kyoichi` → `/reload-plugins`(ツール一覧は `/mcp reconnect`) |

プラグインの実体は marketplace キャッシュで、ローカルリポの編集は update を回すまで配布されない。

記録の掃除は人間の CLI だけ(エージェントの語彙には「記録を消す」を入れない):

```bash
claude-gate forget <repoKey|path> [--build <id> | --report <id> | --evidence <id>]
```

## 知りたいことはどこにあるか

| 知りたいこと | 場所 |
|---|---|
| 思想・ループ・語彙(人間向けの説明書) | ダッシュボード http://127.0.0.1:7350/ の「ガイド」 |
| 実装の構造・設計原則・データの置き場・テスト | [`docs/architecture.md`](docs/architecture.md) |
| ツールの一覧・引数・拒否条件 | `src/kernel/server.ts` の登録定義(実装が正) |
| 語彙の定義(日本語の正式名 ⇄ 英語識別子) | `src/ios/words.ts` |
| ダッシュボードの設計 | [`docs/dashboard-design.md`](docs/dashboard-design.md) |
