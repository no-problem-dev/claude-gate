import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openReport } from "../src/ios/tools/open_report.js";
import { runCheck } from "../src/ios/tools/run_check.js";
import type { Report } from "../src/ios/words.js";

// 確かめの実行: ゲート自身がコマンドを実行して証拠化する(自己申告の「テスト回しました」を排す)

let worksite: string;

function repoDir(): string {
  const reposRoot = join(process.env.GATE_HOME as string, "repos");
  return join(reposRoot, readdirSync(reposRoot)[0]);
}

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  execFileSync("git", ["-C", worksite, "init", "-q"]);
});

describe("runCheck", () => {
  it("gate.yaml に宣言が無ければ拒否される", () => {
    const result = runCheck({ worksitePath: worksite, check: "unit_test" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.fix).toContain("checks.unit_test");
  });

  it("スクショ系はコマンド実行できない(attach_evidence の領分)", () => {
    const result = runCheck({ worksitePath: worksite, check: "screenshot" });
    expect(result.status).toBe("rejected");
  });

  it("実行して終了コードと出力ログが証拠になる(緑)", () => {
    writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo all-green"\n');
    const result = runCheck({ worksitePath: worksite, check: "unit_test" });
    if (result.status !== "ok") throw new Error(`expected ok: ${JSON.stringify(result)}`);
    expect(result.state.kind).toBe("check_run");
    expect(result.state.exitCode).toBe(0);
    expect(readFileSync(result.state.storedFile, "utf8")).toContain("all-green");
  });

  it("赤(終了コード非0)もそのまま事実として記録される", () => {
    writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo boom; exit 3"\n');
    const result = runCheck({ worksitePath: worksite, check: "unit_test" });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.state.exitCode).toBe(3);
  });

  it("同一ソース・同一結果の再実行はべき等に収束する", () => {
    writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo same"\n');
    const first = runCheck({ worksitePath: worksite, check: "unit_test" });
    const second = runCheck({ worksitePath: worksite, check: "unit_test" });
    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    expect(second.state.evidenceId).toBe(first.state.evidenceId);
    expect(second.note).toContain("既に記録済み");
  });

  it("報告の動作に紐づき、状態が 証拠あり に移る", () => {
    writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo ok"\n');
    const report = openReport({
      worksitePath: worksite,
      title: "紐づけテスト",
      behaviors: [{ behavior: "計算が合う", change_kind: "logic", check: "unit_test" }],
    });
    if (report.status !== "ok") throw new Error("expected ok");
    const result = runCheck({
      worksitePath: worksite,
      check: "unit_test",
      reportId: report.state.reportId,
      behaviorIndex: 1,
    });
    if (result.status !== "ok") throw new Error("expected ok");
    const saved = JSON.parse(
      readFileSync(join(repoDir(), "reports", `${report.state.reportId}.json`), "utf8"),
    ) as Report;
    expect(saved.state).toBe("evidenced");
    expect(saved.evidence.length).toBe(1);
  });

  it("紐づけ先の検証は実行より先(範囲外の番号でコマンドは走らない)", () => {
    writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo ran > mark.txt"\n');
    const report = openReport({
      worksitePath: worksite,
      title: "先行検証テスト",
      behaviors: [{ behavior: "計算が合う", change_kind: "logic", check: "unit_test" }],
    });
    if (report.status !== "ok") throw new Error("expected ok");
    const result = runCheck({
      worksitePath: worksite,
      check: "unit_test",
      reportId: report.state.reportId,
      behaviorIndex: 9,
    });
    expect(result.status).toBe("rejected");
    expect(readdirSync(worksite)).not.toContain("mark.txt");
  });
});
