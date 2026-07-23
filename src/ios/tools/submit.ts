import { join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { repoDirOf, writeJson } from "../../kernel/store.js";
import { readReport } from "../report_link.js";
import type { Reply, Report } from "../words.js";

// 提出する: 検証と人間確認が終わった報告を「検証したソース(sourceSha)を受け入れた」と記録する。
// 記録だけの状態遷移 — git や gh のコマンドは実行しない(ゲートは世界を読むが変えない)。
// 取り込みに向かう操作(レビュー可能化・デフォルトブランチへの push・merge)は、この記録に依存する
// 消費者(PreToolUse hook・ブランチ保護・人間)がガードする(words.ts の境界線)。
// 「デフォルトブランチに入った / 取り込み待ち」は読み取りモデルの導出で、ここでは扱わない。

export interface SubmitArgs {
  worksitePath: string;
  reportId: string;
  via?: "dashboard"; // 入口。人間がダッシュボードから提出する場合(省略 = MCP ツール経由)。監査で経路を見返せる
}

const STATE_FIX: Record<string, string> = {
  draft: "証拠を付けて judge で合格させてから提出してください",
  evidenced: "judge で判定してください(合格した報告だけが提出できる)",
  failed: "不合格の reason を直し、証拠を集め直して judge し直してください",
  unconfirmed: "確認できず は人間に渡す出口です。人間の確認を経ずに提出はできません",
};

export function submit(args: SubmitArgs): Reply<Report> {
  const gateDir = repoDirOf(args.worksitePath);
  const reject = (reason: string, fix: string, nextSteps: string[]): Reply<Report> => {
    appendEvent(gateDir, {
      tool: "submit",
      result: "rejected",
      reportId: args.reportId,
      reason,
      ...(args.via !== undefined && { via: args.via }),
    });
    return { status: "rejected", reason, fix, nextSteps };
  };

  const report = readReport(gateDir, args.reportId);
  if (report === null) {
    return reject(`報告 ${args.reportId} が未オープン`, "先に open_report で報告を開いてください", ["open_report"]);
  }
  if (report.state === "submitted") {
    appendEvent(gateDir, {
      tool: "submit",
      result: "ok",
      reportId: report.reportId,
      alreadySubmitted: true,
      ...(args.via !== undefined && { via: args.via }),
    });
    const at = report.submission?.recordedAt ?? report.submission?.readiedAt ?? report.submission?.pushedAt;
    return {
      status: "ok",
      state: report,
      note: `既提出の報告(提出: ${at})。提出はし直さない`,
      nextSteps: [],
    };
  }
  if (report.state !== "passed") {
    const label = { draft: "下書き", evidenced: "証拠あり", failed: "不合格", unconfirmed: "確認できず" }[report.state];
    return reject(`合格していない報告は提出できない(現在: ${label})`, STATE_FIX[report.state], ["judge"]);
  }
  const sourceSha = report.judgment?.sourceSha ?? null;
  if (sourceSha === null) {
    return reject(
      "検証したソースが確定していない(dirty なソースでの検証、または旧形式の判定)",
      "クリーンなソースで証拠を取り直し、judge し直してから提出してください",
      ["run_check", "attach_evidence", "judge"],
    );
  }

  report.state = "submitted";
  report.submission = {
    sha: sourceSha,
    ...(report.branch !== undefined && { branch: report.branch }),
    recordedAt: new Date().toISOString(),
    ...(args.via !== undefined && { via: args.via }),
  };
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  // 原因のできごとが結果(報告の状態)を運ぶ。独立した report_state 行は書かない。
  // branch は載せない(報告の記録が持つ。旧形式の push イベントとの区別にも使う)
  appendEvent(gateDir, {
    tool: "submit",
    result: "ok",
    reportId: report.reportId,
    sha: sourceSha,
    reportState: "submitted",
    ...(args.via !== undefined && { via: args.via }),
  });
  return {
    status: "ok",
    state: report,
    note:
      `提出を記録した(検証したソース ${sourceSha.slice(0, 7)} を受け入れ)。` +
      "取り込みに向かう操作(レビュー可能化・merge・デフォルトブランチへの push)は、消費者がこの記録と照合する。" +
      "この報告は終着 — 続きは新しい作業名で",
    nextSteps: [],
  };
}
