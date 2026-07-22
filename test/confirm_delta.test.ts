import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmDelta } from "../src/ios/confirm.js";
import { judge } from "../src/ios/tools/judge.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { runCheck } from "../src/ios/tools/run_check.js";

// 差分確認(confirm-delta): 人間だけの操作。検証したソースの後に積まれた差分の引き受けを記録し、
// 再判定が sourceSha を先へ進める(submit の三点照合は変えない)

let worksite: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", worksite, ...args], { encoding: "utf8" }).trim();
}

function commit(message: string): string {
  execFileSync("git", ["-C", worksite, "add", "-A"]);
  execFileSync("git", [
    "-C",
    worksite,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    message,
  ]);
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  execFileSync("git", ["-C", worksite, "init", "-q"]);
  writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo all-green"\n');
});

// クリーンなソースで合格まで通す(判定の sourceSha = いまの HEAD)
function passedReport(): string {
  const report = openReport({
    worksitePath: worksite,
    title: "差分確認テスト",
    behaviors: [{ behavior: "計算が正しい", change_kind: "logic", check: "unit_test" }],
  });
  if (report.status !== "ok") throw new Error("expected ok");
  runCheck({ worksitePath: worksite, check: "unit_test", reportId: report.state.reportId, behaviorIndex: 1 });
  const judged = judge({ worksitePath: worksite, reportId: report.state.reportId });
  if (judged.status !== "ok" || judged.state.state !== "passed") {
    throw new Error(`expected passed: ${JSON.stringify(judged)}`);
  }
  return report.state.reportId;
}

describe("confirmDelta", () => {
  it("差分確認を記録すると再判定で sourceSha が HEAD まで進む(verifiedSha は機械検証のまま)", () => {
    const verified = commit("init");
    const reportId = passedReport();
    writeFileSync(join(worksite, "after.txt"), "x");
    const head = commit("検証後のコミット");

    const result = confirmDelta({ worksitePath: worksite, report: reportId, note: "差分を見た。ログ修正のみ" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.state.state).toBe("passed");
    expect(result.state.judgment?.sourceSha).toBe(head);
    expect(result.state.judgment?.verifiedSha).toBe(verified);
    expect(result.state.deltaConfirms).toHaveLength(1);
    expect(result.state.deltaConfirms?.[0]).toMatchObject({ fromSha: verified, toSha: head, note: "差分を見た。ログ修正のみ" });
  });

  it("さらにコミットが積まれたら差分確認は連鎖する", () => {
    commit("init");
    const reportId = passedReport();
    commit("1つ目");
    confirmDelta({ worksitePath: worksite, report: reportId, note: "1つ目を見た" });
    const head2 = commit("2つ目");

    const result = confirmDelta({ worksitePath: worksite, report: reportId, note: "2つ目を見た" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.state.judgment?.sourceSha).toBe(head2);
    expect(result.state.deltaConfirms).toHaveLength(2);
  });

  it("同じ差分の再確認はべき等(記録は1件に収束する)", () => {
    commit("init");
    const reportId = passedReport();
    commit("検証後のコミット");
    const args = { worksitePath: worksite, report: reportId, note: "確認した" };
    const first = confirmDelta(args);
    const second = confirmDelta(args);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.state.deltaConfirms).toHaveLength(1);
    expect(second.state.state).toBe("passed");
  });

  it("差分がない(HEAD = 検証したソース)なら拒否 — そのまま提出できる", () => {
    commit("init");
    const reportId = passedReport();
    const result = confirmDelta({ worksitePath: worksite, report: reportId, note: "x" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.reason).toContain("差分がない");
  });

  it("未判定の報告は拒否(差分確認は判定済みの sourceSha を進める操作)", () => {
    commit("init");
    const report = openReport({
      worksitePath: worksite,
      title: "未判定",
      behaviors: [{ behavior: "計算が正しい", change_kind: "logic", check: "unit_test" }],
    });
    if (report.status !== "ok") throw new Error("expected ok");
    commit("先へ");
    const result = confirmDelta({ worksitePath: worksite, report: report.state.reportId, note: "x" });
    expect(result.status).toBe("rejected");
  });

  it("検証したソースが HEAD の祖先でない(rebase・巻き戻し)なら拒否", () => {
    const base = commit("init");
    writeFileSync(join(worksite, "b.txt"), "b");
    commit("検証するコミット");
    const reportId = passedReport();
    git("reset", "--hard", base);
    writeFileSync(join(worksite, "c.txt"), "c");
    commit("別系統のコミット");

    const result = confirmDelta({ worksitePath: worksite, report: reportId, note: "x" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.reason).toContain("祖先ではない");
  });

  it("確認内容(note)が空なら拒否", () => {
    commit("init");
    const reportId = passedReport();
    commit("先へ");
    const result = confirmDelta({ worksitePath: worksite, report: reportId, note: "  " });
    expect(result.status).toBe("rejected");
  });

  it("提出済みの報告は拒否(終着はもう変わらない)", () => {
    commit("init");
    const reportId = passedReport();
    const reposDir = join(process.env.GATE_HOME!, "repos");
    const repoKey = readdirSync(reposDir)[0];
    const path = join(reposDir, repoKey, "reports", `${reportId}.json`);
    const record = JSON.parse(readFileSync(path, "utf8")) as { state: string };
    record.state = "submitted";
    writeFileSync(path, JSON.stringify(record));
    commit("先へ");
    const result = confirmDelta({ worksitePath: worksite, report: reportId, note: "x" });
    expect(result.status).toBe("rejected");
  });

  it("ダッシュボード発の記録は監査に via: dashboard と差分(fromSha/toSha)が残る", () => {
    const verified = commit("init");
    const reportId = passedReport();
    const head = commit("先へ");
    const result = confirmDelta({ worksitePath: worksite, report: reportId, note: "見た", via: "dashboard" });
    expect(result.status).toBe("ok");
    const reposDir = join(process.env.GATE_HOME!, "repos");
    const repoKey = readdirSync(reposDir)[0];
    const events = readFileSync(join(reposDir, repoKey, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const event = events.find((e) => e.tool === "confirm_delta");
    expect(event).toMatchObject({ via: "dashboard", fromSha: verified, toSha: head, commits: 1 });
  });
});
