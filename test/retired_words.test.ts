import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 退役語の台帳: 比喩・間接表現として却下した語。命名規律(日本語の日常語・直接表現・比喩禁止)の
// 機械検査 — 語彙・実装・文書のどこにも再登場できない(このテストが落ちる)。
// 却下の経緯: 関所→ゲート / 指紋→ビルドID / 世界→git・GitHub(または origin)/
// 静けさ→「表示が無いことが正常」等の直接表現
const RETIRED_WORDS = ["関所", "指紋", "世界", "静けさ"];

// 検査対象: 生きている定義面(実装・語彙・ガイド・設計文書・スキル・hook)。
// docs/dashboard-review.md は過去のレビュー記録(歴史)なので対象外
const TARGETS = ["src", "dashboard/src", "hooks", "skills", "test", "docs/architecture.md", "docs/dashboard-design.md", "README.md"];
const EXCLUDE_FILES = new Set(["retired_words.test.ts"]);
const EXTENSIONS = /\.(ts|tsx|css|md|sh|json|html)$/;

function collect(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return EXTENSIONS.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => name !== "node_modules" && !EXCLUDE_FILES.has(name))
    .flatMap((name) => collect(join(path, name)));
}

describe("退役語の台帳", () => {
  const root = join(__dirname, "..");
  const files = TARGETS.flatMap((t) => collect(join(root, t)));

  it("検査対象のファイルが集まっている", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const word of RETIRED_WORDS) {
    it(`退役語「${word}」が実装・語彙・文書に登場しない`, () => {
      const hits = files
        .filter((f) => readFileSync(f, "utf8").includes(word))
        .map((f) => f.slice(root.length + 1));
      expect(hits, `「${word}」が残っている: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
