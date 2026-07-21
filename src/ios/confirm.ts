import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { appendEvent } from "../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../kernel/store.js";
import { linkToReport, readReport, validateLink } from "./report_link.js";
import { judge } from "./tools/judge.js";
import type { Evidence, Reply, Report } from "./words.js";

// 人間確認(confirm): 人間が動作を自分の目で確かめた事実を、証拠(kind: human_check)として記録する。
// 掃除(forget)と同じく**人間だけの CLI 操作** — エージェントの語彙(MCP ツール)には入れない。
// 「確認できず」は人間に渡す正式な出口だが、渡された先の記録手段が無いと注意が永遠に積み上がる。
// 人間確認は証拠なので、判定(judge)は決定論のまま — 記録後に自動で再判定し、報告を前へ進める

export interface ConfirmArgs {
  worksitePath: string;
  report: string; // 作業名 または reportId(12桁hex)
  behaviorIndex: number;
  note: string; // 何をどう確認したか(人間確認の顔。必須)
  via?: "dashboard"; // 入口。人間の操作面は CLI とダッシュボードの2つ(省略 = CLI)。監査で経路を見返せるように記録する
}

function resolveReport(gateDir: string, ref: string): Report | null {
  if (/^[0-9a-f]{12}$/.test(ref)) {
    const byId = readReport(gateDir, ref);
    if (byId !== null) return byId;
  }
  const repoKey = basename(gateDir);
  const reportId = createHash("sha256").update(`${repoKey}\0${ref}`).digest("hex").slice(0, 12);
  return readReport(gateDir, reportId);
}

export function confirmBehavior(args: ConfirmArgs): Reply<Report> {
  const gateDir = repoDirOf(args.worksitePath);
  const reject = (reason: string, fix: string, reportId?: string): Reply<Report> => {
    appendEvent(gateDir, {
      tool: "confirm",
      result: "rejected",
      reportId,
      reason,
      ...(args.via !== undefined && { via: args.via }),
    });
    return { status: "rejected", reason, fix, nextSteps: [] };
  };

  const note = args.note.trim();
  if (note.length === 0) {
    return reject("確認内容(note)が空", "何をどう確認したかを --note で書いてください(人間確認の顔になる)");
  }
  const report = resolveReport(gateDir, args.report.trim());
  if (report === null) {
    return reject(`報告「${args.report}」が見つからない`, "作業名か reportId をダッシュボードの完了報告タブで確認してください");
  }
  const linkProblem = validateLink(report, report.reportId, args.behaviorIndex);
  if (linkProblem !== null) {
    return reject(linkProblem.reason, linkProblem.fix, report.reportId);
  }

  // 証拠ID は中身から決める(べき等)。記録本文は不変のテキストファイル
  const evidenceId = createHash("sha256")
    .update(`human_check\0${report.reportId}\0${args.behaviorIndex}\0${note}`)
    .digest("hex")
    .slice(0, 12);
  const recordPath = join(gateDir, "evidence", `${evidenceId}.json`);
  const existing = readJson<Evidence>(recordPath);

  let evidence: Evidence;
  if (existing !== null) {
    evidence = existing;
  } else {
    const storedFile = join(gateDir, "evidence", `${evidenceId}.txt`);
    const attachedAt = new Date().toISOString();
    writeFileSync(
      storedFile,
      [
        "人間確認の記録",
        `報告: ${report.title}(${report.reportId})`,
        `動作: ${args.behaviorIndex}. ${report.behaviors[args.behaviorIndex - 1]?.behavior ?? ""}`,
        `確認: ${note}`,
        `記録: ${attachedAt}`,
      ].join("\n") + "\n",
    );
    evidence = { evidenceId, kind: "human_check", storedFile, note, attachedAt };
    writeJson(recordPath, evidence);
  }

  const link = linkToReport(gateDir, report, args.behaviorIndex, evidenceId, null);
  appendEvent(gateDir, {
    tool: "confirm",
    result: "ok",
    reportId: report.reportId,
    behaviorIndex: args.behaviorIndex,
    evidenceId,
    ...(args.via !== undefined && { via: args.via }),
    ...(existing !== null && { alreadyAttached: true }),
    ...(link.reportState !== undefined && { reportState: link.reportState }),
    ...(link.judgmentInvalidated === true && { judgmentInvalidated: true }),
  });

  // 人間確認は証拠 — 記録したら決定論の判定で報告を前へ進める(1コマンドで解決まで運ぶ)
  const judged = judge({ worksitePath: args.worksitePath, reportId: report.reportId });
  if (judged.status === "rejected") {
    return {
      status: "ok",
      state: report,
      note: `人間確認を記録した(動作${args.behaviorIndex})が、再判定は拒否された: ${judged.reason}`,
      nextSteps: [],
    };
  }
  return {
    status: "ok",
    state: judged.state,
    note: `人間確認を記録した(動作${args.behaviorIndex}: ${note})。${judged.note ?? ""}`,
    nextSteps: judged.state.state === "passed" ? ["submit"] : [],
  };
}
