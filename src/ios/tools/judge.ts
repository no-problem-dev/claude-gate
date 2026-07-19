import { join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { effectiveCannotSee, effectivePassline, loadGateYaml } from "../gate_yaml.js";
import { judgeReport } from "../judge_core.js";
import { readReport } from "../report_link.js";
import type { Build, Evidence, Reply, Report } from "../words.js";

// 判定する: ゲート(決定論)が報告と証拠を合格ラインに照らす。動かしたエージェント自身は判定できない(A6)。
// 読み書きの殻: 入力を集めてコア(judge_core)に渡し、結果を報告レコードと状態に反映する

export interface JudgeArgs {
  worksitePath: string;
  reportId: string;
}

const VERDICT_LABEL = { passed: "合格", failed: "不合格", unconfirmed: "確認できず" } as const;

export function judge(args: JudgeArgs): Reply<Report> {
  const gateDir = repoDirOf(args.worksitePath);
  const reject = (reason: string, fix: string, nextSteps: string[]): Reply<Report> => {
    appendEvent(gateDir, { tool: "judge", result: "rejected", reportId: args.reportId, reason });
    return { status: "rejected", reason, fix, nextSteps };
  };

  const report = readReport(gateDir, args.reportId);
  if (report === null) {
    return reject(`報告 ${args.reportId} が未オープン`, "先に open_report で報告を開いてください", ["open_report"]);
  }
  if (report.state === "draft") {
    return reject(
      "証拠がまだ1件も付いていない報告は判定できない",
      "attach_evidence(シミュレータ観測)か run_check(テスト実行)で証拠を付けてください",
      ["attach_evidence", "run_check"],
    );
  }

  const yaml = loadGateYaml(args.worksitePath);
  if (yaml.error !== undefined) {
    return reject(yaml.error, "リポジトリの gate.yaml を直してください", ["judge"]);
  }

  const evidenceById: Record<string, Evidence> = {};
  for (const link of report.evidence) {
    const record = readJson<Evidence>(join(gateDir, "evidence", `${link.evidenceId}.json`));
    if (record !== null) evidenceById[link.evidenceId] = record;
  }
  const buildsById: Record<string, Build> = {};
  for (const buildId of report.buildIds) {
    const record = readJson<Build>(join(gateDir, "builds", `${buildId}.json`));
    if (record !== null) buildsById[buildId] = record;
  }

  const result = judgeReport({
    report,
    evidenceById,
    buildsById,
    passline: effectivePassline(yaml.config),
    cannotSee: effectiveCannotSee(yaml.config),
  });

  report.judgment = { ...result, judgedAt: new Date().toISOString() };
  report.state = result.verdict;
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  appendEvent(gateDir, { tool: "judge", result: "ok", reportId: report.reportId, verdict: result.verdict });
  appendEvent(gateDir, { tool: "report_state", result: "ok", reportId: report.reportId, state: result.verdict });

  const okCount = result.behaviors.filter((b) => b.verdict === "ok").length;
  const noteBase = `判定: ${VERDICT_LABEL[result.verdict]}(OK ${okCount}/${report.behaviors.length})`;
  if (result.verdict === "passed") {
    return {
      status: "ok",
      state: report,
      note: `${noteBase}。提出(submit)はスライス3 で実装予定 — 現時点の提出判断は人間`,
      nextSteps: [],
    };
  }
  if (result.verdict === "failed") {
    return {
      status: "ok",
      state: report,
      note: `${noteBase}。動作ごとの reason を直し、証拠を集め直してから judge し直す`,
      nextSteps: ["attach_evidence", "run_check", "judge"],
    };
  }
  return {
    status: "ok",
    state: report,
    note: `${noteBase}。確認できず は人間に渡す正式な出口 — reason を添えてユーザーに確認を依頼する`,
    nextSteps: [],
  };
}
