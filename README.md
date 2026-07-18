# claude-gate

AI との iOS 開発で、エージェントの「できました」に証拠を義務づけ、証拠の出所を機械で確かめ、確かめられたものだけを提出するためのゲート。マシンに1つ常駐するローカル MCP サーバ(HTTP・127.0.0.1:7350)。

設計文書の SSOT は life リポジトリの `os/write/`:

- `ios-domain-model.md` — ドメインモデル(完了報告と証拠・対訳表)
- `ios-task-loop.md` — タスク一枚のループ(変更の種類 → 最低限の確かめ方)
- `ios-gate-implementation.md` — 実装方針(素通し / 採用時に確かめる / ゲートのみ)
- `ios-parallel.md` — 並列と冪等(デーモン1台・全操作べき等)
- `ios-gate-spec.md` — スライス1実装仕様

## いま出来ること(スライス1)

| ツール | 内容 |
|---|---|
| `ping` | 生存確認 |
| `register_build` | ビルドを登録する。`.app` の中身からビルドID を計算(git の commit ID と同じ仕組み) |
| `attach_evidence` | 証拠を付ける。受理前にシミュレータ内の実物と ID 照合し、別のビルドなら拒否する |

## セットアップ

```bash
npm install && npm run build
node dist/cli.js install   # launchd 常駐 + 稼働確認(将来: npm i -g claude-gate → claude-gate install)
node dist/cli.js doctor    # 稼働状態とデータの場所
```

対象プロジェクトの `.mcp.json`(または claude-gate プラグイン):

```json
{
  "mcpServers": {
    "gate": { "type": "http", "url": "http://127.0.0.1:7350/mcp" }
  }
}
```

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
