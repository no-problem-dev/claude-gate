import { join } from "node:path";
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
  if (report.state === "submitted") {
    return {
      reason: `報告「${report.title}」は提出済みで、もう変わらない`,
      fix: "続きの作業は新しい作業名で報告を開いてください",
    };
  }
  if (!Number.isInteger(behaviorIndex) || behaviorIndex < 1 || behaviorIndex > report.behaviors.length) {
    return {
      reason: `動作の番号 ${behaviorIndex} が範囲外(この報告の動作一覧は 1〜${report.behaviors.length})`,
      fix: "open_report の応答にある動作一覧の番号を使ってください",
    };
  }
  return null;
}

// 紐づけの結果。状態の変化はできごとを書かず、原因のできごと(attach_evidence / run_check)が運ぶ —
// 独立した report_state 行は因果の逆順と二重記録を生むのでやめた(docs/dashboard-design.md「できごとタブの構造」)
export interface LinkResult {
  note: string;
  reportState?: "evidenced"; // 紐づけで報告の状態が動いたときだけ
  judgmentInvalidated?: true; // 判定済みの報告に証拠が増えて判定を無効化したときだけ
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
): LinkResult {
  const already = report.evidence.some((e) => e.evidenceId === evidenceId && e.behaviorIndex === behaviorIndex);
  if (already) {
    return { note: `。報告「${report.title}」の動作${behaviorIndex}には既に紐づいている` };
  }
  report.evidence.push({ evidenceId, behaviorIndex });
  if (buildId !== null && !report.buildIds.includes(buildId)) report.buildIds.push(buildId);

  const result: LinkResult = { note: "" };
  let stateNote = "";
  if (report.state === "draft") {
    report.state = "evidenced";
    result.reportState = "evidenced";
    stateNote = "(状態: 下書き → 証拠あり)";
  } else if (report.state !== "evidenced") {
    report.state = "evidenced";
    delete report.judgment;
    result.reportState = "evidenced";
    result.judgmentInvalidated = true;
    stateNote = "(証拠が増えたため判定は無効。状態: 証拠あり に戻した — judge で判定し直す)";
  }
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  result.note = `。報告「${report.title}」の動作${behaviorIndex}に紐づけた${stateNote}`;
  return result;
}
