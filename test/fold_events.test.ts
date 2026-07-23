import { describe, expect, it } from "vitest";
import { eventSentence, foldReportStateEvents } from "../dashboard/src/lib.js";
import type { GateEvent } from "../dashboard/src/lib.js";

// 旧形式の独立した report_state 行は、隣接する原因行に畳んで表示する(記録は書き換えない)

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

describe("foldReportStateEvents", () => {
  it("原因行の直後の report_state を畳み、状態を原因行に移す", () => {
    const events: GateEvent[] = [
      { ts: at(0), tool: "attach_evidence", result: "ok", reportId: "r1", evidenceId: "e1" },
      { ts: at(0), tool: "report_state", result: "ok", reportId: "r1", state: "evidenced" },
    ];
    const folded = foldReportStateEvents(events);
    expect(folded).toHaveLength(1);
    expect(folded[0].tool).toBe("attach_evidence");
    expect(folded[0].reportState).toBe("evidenced");
  });

  it("因果が逆順に記録された旧データ(report_state が原因より先)も畳める", () => {
    const events: GateEvent[] = [
      { ts: at(0), tool: "report_state", result: "ok", reportId: "r1", state: "evidenced" },
      { ts: at(0), tool: "attach_evidence", result: "ok", reportId: "r1", evidenceId: "e1" },
    ];
    const folded = foldReportStateEvents(events);
    expect(folded).toHaveLength(1);
    expect(folded[0].tool).toBe("attach_evidence");
    expect(folded[0].reportState).toBe("evidenced");
  });

  it("別の報告・遠い時刻の report_state は畳まない(文だけの行として残る)", () => {
    const events: GateEvent[] = [
      { ts: at(0), tool: "attach_evidence", result: "ok", reportId: "r1" },
      { ts: at(30), tool: "report_state", result: "ok", reportId: "r2", state: "passed" },
    ];
    expect(foldReportStateEvents(events)).toHaveLength(2);
  });
});

describe("eventSentence — 原因が結果を運ぶ", () => {
  it("証拠の受理は報告の状態の変化を文に付記する", () => {
    const event: GateEvent = {
      ts: at(0),
      tool: "attach_evidence",
      result: "ok",
      reportId: "r1",
      reportState: "evidenced",
    };
    expect(eventSentence(event)).toBe("証拠を受理 → 報告は「証拠あり」へ");
  });

  it("判定の無効化は明示する", () => {
    const event: GateEvent = {
      ts: at(0),
      tool: "attach_evidence",
      result: "ok",
      reportId: "r1",
      reportState: "evidenced",
      judgmentInvalidated: true,
    };
    expect(eventSentence(event)).toBe("証拠を受理 → 判定は無効になり、報告は「証拠あり」に戻った");
  });

  it("判定・提出の文には付記しない(文自体が結果を含む)", () => {
    expect(
      eventSentence({ ts: at(0), tool: "judge", result: "ok", reportId: "r1", verdict: "passed", reportState: "passed" }),
    ).toBe("判定した — 合格");
    // 新形式の提出(記録だけ)は branch を運ばない。branch がある行は旧形式(提出 = push)の記録
    expect(
      eventSentence({ ts: at(0), tool: "submit", result: "ok", reportId: "r1", sha: "a".repeat(40), reportState: "submitted" }),
    ).toBe("提出を記録した — 検証したソースを受け入れ");
    expect(
      eventSentence({ ts: at(0), tool: "submit", result: "ok", reportId: "r1", branch: "main", reportState: "submitted" }),
    ).toBe("提出した — main を push(旧形式)");
  });
});
