import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 取り込みガード hook(消費者): 共有(feature ブランチへの push・下書きPR の作成)は通し、
// merge・非ドラフト PR 作成・デフォルトブランチ直 push は遮断する。
// レビュー可能化(gh pr ready)は「ブランチ先端の sha に一致する提出済みの報告があるか」を
// デーモンに照会して通す/遮断する — ここではスタブ HTTP サーバー(GATE_PORT 注入)で再現する。
// bash をそのまま起動し、JSON 入力 → 終了コード(0 = 通す / 2 = 遮断)のテーブルで検証する

const hookPath = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "guard-official.sh");

let worksite: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", worksite, ...args], { encoding: "utf8" }).trim();
}

function runHook(
  command: string,
  options: { cwd?: string; gatePort?: number } = {},
): { status: number; stderr: string } {
  const input = JSON.stringify({ tool_input: { command }, cwd: options.cwd ?? worksite });
  const result = spawnSync("bash", [hookPath], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...(options.gatePort !== undefined && { GATE_PORT: String(options.gatePort) }) },
  });
  return { status: result.status ?? -1, stderr: result.stderr };
}

// 照会分岐のテストは非同期で hook を起動する: spawnSync はイベントループを塞ぎ、
// 同一プロセス内のスタブサーバーが curl に応答できなくなる(実測でタイムアウトした)
function runHookAsync(command: string, gatePort: number): Promise<{ status: number; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("bash", [hookPath], {
      env: { ...process.env, GATE_PORT: String(gatePort) },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolvePromise({ status: code ?? -1, stderr }));
    child.stdin.write(JSON.stringify({ tool_input: { command }, cwd: worksite }));
    child.stdin.end();
  });
}

// 提出済み照会のスタブ(デーモンの GET /api/submitted の代役)。受けた query も記録する
function submittedStub(submitted: boolean): Promise<{
  server: Server;
  port: number;
  queries: URLSearchParams[];
}> {
  return new Promise((resolvePromise) => {
    const queries: URLSearchParams[] = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      queries.push(url.searchParams);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ submitted }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolvePromise({ server, port, queries });
    });
  });
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

  it("PR 番号指定のレビュー可能化(ブランチ先端を解決できない)", () => {
    const result = runHook("gh pr ready 12");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ブランチ名");
  });

  it("API 経由のレビュー可能化", () => {
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

describe("レビュー可能化は提出の記録との照合で決まる(デーモン照会)", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("ブランチ先端に一致する提出済みの報告があれば通す", async () => {
    git("checkout", "-q", "-b", "feature/foo");
    const stub = await submittedStub(true);
    server = stub.server;
    const result = await runHookAsync("gh pr ready feature/foo", stub.port);
    expect(result.status).toBe(0);
    // 照会にはブランチ先端の完全な sha が載る
    expect(stub.queries[0]?.get("sha")).toBe(git("rev-parse", "feature/foo"));
  });

  it("引数なし(チェックアウト中のブランチ)でも照会して通す", async () => {
    git("checkout", "-q", "-b", "feature/bar");
    const stub = await submittedStub(true);
    server = stub.server;
    expect((await runHookAsync("gh pr ready", stub.port)).status).toBe(0);
  });

  it("提出の記録が無ければ遮断する(fix は judge → submit)", async () => {
    git("checkout", "-q", "-b", "feature/foo");
    const stub = await submittedStub(false);
    server = stub.server;
    const result = await runHookAsync("gh pr ready feature/foo", stub.port);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("提出済みの報告が無い");
    expect(result.stderr).toContain("submit");
  });

  it("デーモンに照会できないときは遮断側に倒す", async () => {
    git("checkout", "-q", "-b", "feature/foo");
    // 誰も聴いていないポートに向ける(空きポートを取ってすぐ閉じる)
    const stub = await submittedStub(false);
    const deadPort = stub.port;
    stub.server.close();
    await new Promise((r) => setTimeout(r, 50));
    const result = await runHookAsync("gh pr ready feature/foo", deadPort);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("照会できない");
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
