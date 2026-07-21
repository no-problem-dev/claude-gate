import { describe, expect, it } from "vitest";
import { unresolvedRejections } from "../src/kernel/attention.js";

// 注意の導出: 拒否は正常ループの一部。「拒否されたまま解決していない」ものだけが注意に値する

const reports = new Map([
  ["r1", "evidenced"],
  ["r2", "evidenced"],
]);

describe("unresolvedRejections", () => {
  it("報告に紐づく拒否は、同じ報告のその後の成功(別ツールでも)で解消する", () => {
    const events = [
      { tool: "submit", result: "rejected" as const, reportId: "r1" },
      { tool: "judge", result: "ok" as const, reportId: "r1" },
    ];
    expect(unresolvedRejections(events, reports)).toEqual([]);
  });

  it("報告に紐づく拒否は、その後の成功が無ければ未解決", () => {
    const events = [
      { tool: "judge", result: "ok" as const, reportId: "r1" },
      { tool: "submit", result: "rejected" as const, reportId: "r1" },
    ];
    expect(unresolvedRejections(events, reports)).toHaveLength(1);
  });

  it("別の報告の成功では解消しない", () => {
    const events = [
      { tool: "submit", result: "rejected" as const, reportId: "r1" },
      { tool: "submit", result: "ok" as const, reportId: "r2" },
    ];
    expect(unresolvedRejections(events, reports)).toHaveLength(1);
  });

  it("掃除で消えた報告の拒否は解消済みとして扱う", () => {
    const events = [{ tool: "submit", result: "rejected" as const, reportId: "gone" }];
    expect(unresolvedRejections(events, reports)).toEqual([]);
  });

  it("報告に紐づかない拒否は、同じツールのその後の成功で解消する", () => {
    const events = [
      { tool: "open_report", result: "rejected" as const },
      { tool: "open_report", result: "ok" as const, reportId: "r1" },
    ];
    expect(unresolvedRejections(events, reports)).toEqual([]);
  });

  it("報告に紐づかない拒否は、別のツールの成功では解消しない", () => {
    const events = [
      { tool: "register_build", result: "rejected" as const },
      { tool: "attach_evidence", result: "ok" as const },
    ];
    expect(unresolvedRejections(events, reports)).toHaveLength(1);
  });

  it("成功だけの記録からは何も出ない", () => {
    const events = [
      { tool: "register_build", result: "ok" as const },
      { tool: "attach_evidence", result: "ok" as const, reportId: "r1" },
    ];
    expect(unresolvedRejections(events, reports)).toEqual([]);
  });

  it("時系列順を保って未解決だけを返す", () => {
    const events = [
      { tool: "register_build", result: "rejected" as const },
      { tool: "submit", result: "rejected" as const, reportId: "r1" },
    ];
    const result = unresolvedRejections(events, reports);
    expect(result.map((e) => e.tool)).toEqual(["register_build", "submit"]);
  });
});

describe("unresolvedRejections — 終着した報告", () => {
  it("終着(提出済み)した報告への拒否は、解消済みとして扱う(壁であって、やることではない)", () => {
    const states = new Map([["done", "submitted"]]);
    const events = [{ tool: "run_check", result: "rejected" as const, reportId: "done" }];
    expect(unresolvedRejections(events, states)).toEqual([]);
  });
});
