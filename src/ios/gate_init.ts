import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// gate.yaml の雛形。全セクション任意なので、最小限のコメント付きテンプレートを置いて
// 「何を書けるか」を人間に見せる。実際の宣言は人間が git 管理で足す(passline の例外も git に残る)
export const GATE_YAML_TEMPLATE = `# claude-gate 宣言ファイル(全セクション任意。消せば同梱デフォルトで動く)

# 検証環境の前提(依存サービス・起動引数など。エージェントが作業前に読む)
# env:
#   - "Debug ビルドはローカル API サーバー(npm run dev)が必要"
#   - "--screenshot-mode で認証スキップ + 固定データ表示"

# 作業場を開く手順(xcodegen generate など。エージェントが作業前に読む)
# worksite:
#   - "xcodegen generate"

# テスト系の確かめ(compile / unit_test / ui_test)の実行コマンド。
# ゲート自身がこのコマンドを実行して終了コードを証拠にする(run_check)
checks:
  compile: "xcodebuild -scheme YourScheme -destination 'generic/platform=iOS Simulator' build"
  unit_test: "xcodebuild test -scheme YourScheme -destination 'platform=iOS Simulator,name=iPhone 16'"

# 合格ライン(変更の種類 → 使ってよい確かめ方)の上書き。書いた種類だけ同梱デフォルトを置き換える。
# 下限を下げる例外はここに書く(git のコミットに残るのが「例外は人間だけ・記録に残る」の実装)
# passline:
#   interaction: ["interaction_log", "ui_test", "video"]
`;

export interface InitResult {
  status: "created" | "exists";
  path: string;
}

// カレントリポジトリのルートに gate.yaml の雛形を作る。既にあれば上書きせず exists を返す(べき等)
export function initGateYaml(dir: string): InitResult {
  const path = join(dir, "gate.yaml");
  if (existsSync(path)) return { status: "exists", path };
  writeFileSync(path, GATE_YAML_TEMPLATE);
  return { status: "created", path };
}
