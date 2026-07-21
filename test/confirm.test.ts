import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBehavior } from "../src/ios/confirm.js";
import { openReport } from "../src/ios/tools/open_report.js";

// 人間確認(confirm): 人間だけの CLI 操作。確認できずの報告を、証拠の記録 + 自動再判定で前へ進める

let worksite: string;

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  execFileSync("git", ["-C", worksite, "init", "-q"]);
});

function openHumanCheckReport(): string {
  const report = openReport({
    worksitePath: worksite,
    title: "課金フロー確認",
    behaviors: [{ behavior: "購入が完了する", change_kind: "system", check: "human_check" }],
  });
  if (report.status !== "ok") throw new Error("expected ok");
  return report.state.reportId;
}

describe("confirmBehavior", () => {
  it("人間確認を記録すると証拠になり、自動再判定で報告が合格に進む", () => {
    openHumanCheckReport();
    const result = confirmBehavior({
      worksitePath: worksite,
      report: "課金フロー確認", // 作業名で解決できる
      behaviorIndex: 1,
      note: "Xcode Run で購入完了まで確認",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.state.state).toBe("passed");
    expect(result.state.judgment?.behaviors[0].verdict).toBe("ok");
    expect(result.state.judgment?.behaviors[0].reason).toContain("人間が確認した");
    expect(result.state.evidence).toHaveLength(1);
  });

  it("同じ確認の再実行はべき等(証拠は1件に収束し、判定は変わらない)", () => {
    const reportId = openHumanCheckReport();
    const args = { worksitePath: worksite, report: reportId, behaviorIndex: 1, note: "確認済み" };
    const first = confirmBehavior(args);
    const second = confirmBehavior(args);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.state.evidence).toHaveLength(1);
    expect(second.state.state).toBe("passed");
  });

  it("確認内容(note)が空なら拒否", () => {
    openHumanCheckReport();
    const result = confirmBehavior({ worksitePath: worksite, report: "課金フロー確認", behaviorIndex: 1, note: "  " });
    expect(result.status).toBe("rejected");
  });

  it("存在しない報告は拒否", () => {
    const result = confirmBehavior({ worksitePath: worksite, report: "無い作業", behaviorIndex: 1, note: "x" });
    expect(result.status).toBe("rejected");
  });

  it("動作の番号が範囲外なら拒否", () => {
    openHumanCheckReport();
    const result = confirmBehavior({ worksitePath: worksite, report: "課金フロー確認", behaviorIndex: 9, note: "x" });
    expect(result.status).toBe("rejected");
  });
});

describe("confirmBehavior — 入口の記録", () => {
  it("ダッシュボード発の記録は監査に via: dashboard が残る", async () => {
    openHumanCheckReport();
    const result = confirmBehavior({
      worksitePath: worksite,
      report: "課金フロー確認",
      behaviorIndex: 1,
      note: "ダッシュボードから確認",
      via: "dashboard",
    });
    expect(result.status).toBe("ok");
    const { readFileSync, readdirSync } = await import("node:fs");
    const reposDir = join(process.env.GATE_HOME!, "repos");
    const repoKey = readdirSync(reposDir)[0];
    const events = readFileSync(join(reposDir, repoKey, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const confirmEvent = events.find((e) => e.tool === "confirm");
    expect(confirmEvent.via).toBe("dashboard");
  });
});
