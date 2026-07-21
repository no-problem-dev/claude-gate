import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

// 公式化ガード hook: 共有(feature ブランチへの push・下書きPR の作成)は通し、
// 公式化(ドラフト解除・マージ・非ドラフト PR 作成・デフォルトブランチ直 push)だけを遮断する。
// bash をそのまま起動し、JSON 入力 → 終了コード(0 = 通す / 2 = 遮断)のテーブルで検証する

const hookPath = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "guard-official.sh");

let worksite: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", worksite, ...args], { encoding: "utf8" }).trim();
}

function runHook(command: string, cwd: string = worksite): { status: number; stderr: string } {
  const input = JSON.stringify({ tool_input: { command }, cwd });
  const result = spawnSync("bash", [hookPath], { input, encoding: "utf8" });
  return { status: result.status ?? -1, stderr: result.stderr };
}

beforeEach(() => {
  worksite = mkdtempSync(join(tmpdir(), "gate-guard-"));
  const bare = mkdtempSync(join(tmpdir(), "gate-guard-origin-")) + "/origin.git";
  execFileSync("git", ["init", "-q", "--bare", bare]);
  execFileSync("git", ["-C", worksite, "init", "-q", "-b", "develop"]);
  git("remote", "add", "origin", bare);
  writeFileSync(join(worksite, "gate.yaml"), "checks: {}\n");
  git("add", "-A");
  execFileSync("git", ["-C", worksite, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  // origin/HEAD = develop(デフォルトブランチの解決に使う)
  git("update-ref", "refs/remotes/origin/develop", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
});

describe("共有は通す", () => {
  it("feature ブランチへの push", () => {
    expect(runHook("git push origin feature/foo").status).toBe(0);
  });

  it("feature ブランチ上の refspec なし push", () => {
    git("checkout", "-q", "-b", "feature/foo");
    expect(runHook("git push").status).toBe(0);
  });

  it("feature ブランチ上の git push origin HEAD", () => {
    git("checkout", "-q", "-b", "feature/foo");
    expect(runHook("git push origin HEAD").status).toBe(0);
  });

  it("下書きPR の作成", () => {
    expect(runHook('gh pr create --draft --title "t" --body "b"').status).toBe(0);
  });

  it("タグの push", () => {
    expect(runHook("git push origin dev.1.22.2-test").status).toBe(0);
  });

  it("git / gh を含まないコマンド", () => {
    expect(runHook("ls -la").status).toBe(0);
  });
});

describe("公式化は遮断する", () => {
  it("デフォルトブランチへの直接 push", () => {
    const result = runHook("git push origin develop");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("デフォルトブランチ");
  });

  it("refspec 経由(HEAD:develop)", () => {
    expect(runHook("git push origin HEAD:develop").status).toBe(2);
  });

  it("デフォルトブランチ上の refspec なし push", () => {
    expect(runHook("git push").status).toBe(2); // beforeEach の HEAD は develop
  });

  it("force push でも同じ", () => {
    expect(runHook("git push --force origin develop").status).toBe(2);
  });

  it("非ドラフトの PR 作成", () => {
    const result = runHook('gh pr create --title "t" --body "b"');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--draft");
  });

  it("ドラフト解除", () => {
    const result = runHook("gh pr ready 12");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("submit");
  });

  it("API 経由のドラフト解除", () => {
    expect(runHook("gh api graphql -f query='mutation { markPullRequestReadyForReview... }'").status).toBe(2);
  });

  it("マージ", () => {
    const result = runHook("gh pr merge 12 --squash");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("取り込み");
  });

  it("API 経由のマージ", () => {
    expect(runHook("gh api repos/o/r/pulls/12/merge -X PUT").status).toBe(2);
  });
});

describe("スコープ", () => {
  it("gate.yaml の無いリポジトリは全部素通し", () => {
    unlinkSync(join(worksite, "gate.yaml"));
    execFileSync("git", ["-C", worksite, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-am", "rm"]);
    expect(runHook("git push origin develop").status).toBe(0);
    expect(runHook("gh pr merge 12").status).toBe(0);
    expect(runHook("gh pr ready 12").status).toBe(0);
  });
});
