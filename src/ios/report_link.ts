import { join } from "node:path";
import { appendEvent } from "../kernel/audit.js";
import { readJson, writeJson } from "../kernel/store.js";
import type { Report } from "./words.js";

// 証拠と報告の紐づけ(attach_evidence / run_check 共通)。
// 紐づけの検証 → 受理 → 紐づけ、の順序は各ツール側が守る(不正な紐づけ先で受理しない)

export function readReport(gateDir: string, reportId: string): Report | null {
  return readJson<Report>(join(gateDir, "reports", `${reportId}.json`));
}

// reportId / behaviorIndex の宣言の正しさを確かめる。問題があれば拒否理由を返す
export function validateLink(
  report: Report | null,
  reportId: string,
  behaviorIndex: number,
): { reason: string; fix: string } | null {
  if (report === null) {
    return { reason: `報告 ${reportId} が未オープン`, fix: "先に open_report で報告を開いてください" };
  }
  if (!Number.isInteger(behaviorIndex) || behaviorIndex < 1 || behaviorIndex > report.behaviors.length) {
    return {
      reason: `動作の番号 ${behaviorIndex} が範囲外(この報告の動作一覧は 1〜${report.behaviors.length})`,
      fix: "open_report の応答にある動作一覧の番号を使ってください",
    };
  }
  return null;
}

// 受理済みの証拠を報告の動作に紐づける。同じ紐づけはべき等。
// 最初の証拠で 下書き → 証拠あり に移す。判定済みの報告に証拠が増えたら 証拠あり に戻し、
// 判定結果を消す(判定は証拠の集合に対するもの。集合が変わった時点で古い判定は無効)
export function linkToReport(
  gateDir: string,
  report: Report,
  behaviorIndex: number,
  evidenceId: string,
  buildId: string | null,
): string {
  const already = report.evidence.some((e) => e.evidenceId === evidenceId && e.behaviorIndex === behaviorIndex);
  if (already) {
    return `。報告「${report.title}」の動作${behaviorIndex}には既に紐づいている`;
  }
  report.evidence.push({ evidenceId, behaviorIndex });
  if (buildId !== null && !report.buildIds.includes(buildId)) report.buildIds.push(buildId);

  let stateNote = "";
  if (report.state === "draft") {
    report.state = "evidenced";
    stateNote = "(状態: 下書き → 証拠あり)";
  } else if (report.state !== "evidenced") {
    report.state = "evidenced";
    delete report.judgment;
    stateNote = "(証拠が増えたため判定は無効。状態: 証拠あり に戻した — judge で判定し直す)";
  }
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  if (stateNote !== "") {
    appendEvent(gateDir, { tool: "report_state", result: "ok", reportId: report.reportId, state: "evidenced" });
  }
  return `。報告「${report.title}」の動作${behaviorIndex}に紐づけた${stateNote}`;
}
