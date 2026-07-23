import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { appendEvent } from "../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../kernel/store.js";
import { branchTip, commitsBetween, gitSha, isAncestor, resolveSha } from "./git.js";
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

// 差分確認(confirm-delta): 検証したソースの後に積まれたコミットの差分を人間が見た上で、
// 「判定は引き続き有効」と引き受ける(人間だけの操作。信頼層は confirm / forget と同じ)。
// 記録後の自動再判定が差分確認の連鎖で sourceSha を先へ進め、提出の記録が指す検証済みソースを最新に保つ。
// 取り込みに向かう操作(hook のガード)はブランチ先端と提出の記録の一致を見るので、
// 先端を提出したいときの人間の正式な解消経路(推奨は取り直し)

export interface ConfirmDeltaArgs {
  worksitePath: string;
  report: string; // 作業名 または reportId(12桁hex)
  toSha?: string; // 引き受け先。省略 = 報告の作業ブランチ先端(旧報告は作業場の HEAD)。ダッシュボードは判断材料と同じ sha を明示で渡す
  note: string; // 差分の何を見てどう判断したか(記録の顔。必須)
  via?: "dashboard";
}

export function confirmDelta(args: ConfirmDeltaArgs): Reply<Report> {
  const gateDir = repoDirOf(args.worksitePath);
  const reject = (reason: string, fix: string, reportId?: string): Reply<Report> => {
    appendEvent(gateDir, {
      tool: "confirm_delta",
      result: "rejected",
      reportId,
      reason,
      ...(args.via !== undefined && { via: args.via }),
    });
    return { status: "rejected", reason, fix, nextSteps: [] };
  };

  const note = args.note.trim();
  if (note.length === 0) {
    return reject("確認内容(note)が空", "差分の何を見てどう判断したかを --note で書いてください(記録の顔になる)");
  }
  const report = resolveReport(gateDir, args.report.trim());
  if (report === null) {
    return reject(`報告「${args.report}」が見つからない`, "作業名か reportId をダッシュボードの完了報告タブで確認してください");
  }
  if (report.state === "submitted") {
    return reject(
      `報告「${report.title}」は提出済みで、もう変わらない`,
      "続きの作業は新しい作業名で報告を開いてください",
      report.reportId,
    );
  }
  const from = report.judgment?.sourceSha ?? null;
  if (from === null) {
    return reject(
      "検証したソースが確定していない(未判定・dirty なソースでの検証・旧形式の判定)",
      "差分確認は判定済みの報告の sourceSha を先へ進める操作です。先に judge で判定してください",
      report.reportId,
    );
  }
  // 既定の引き受け先は報告の作業ブランチ先端(ローカルのチェックアウト状態に依存しない)。
  // 旧報告(ブランチ記録なし)だけ作業場の HEAD にフォールバック
  const to =
    args.toSha !== undefined
      ? resolveSha(args.worksitePath, args.toSha)
      : report.branch !== undefined
        ? branchTip(args.worksitePath, report.branch)
        : gitSha(args.worksitePath);
  if (to === null) {
    return reject(
      `引き受け先のコミットが解決できない(${args.toSha ?? report.branch ?? "HEAD"})`,
      "worksitePath とコミットID を確認してください",
      report.reportId,
    );
  }
  // 同じ引き受け先の再呼び出しはべき等(1回目の再判定で sourceSha が to まで進んでいるため、
  // from との比較より先に既存記録で判定する)
  const existing = (report.deltaConfirms ?? []).find((d) => d.toSha === to);
  if (existing !== undefined) {
    appendEvent(gateDir, {
      tool: "confirm_delta",
      result: "ok",
      reportId: report.reportId,
      fromSha: existing.fromSha,
      toSha: to,
      alreadyConfirmed: true,
      ...(args.via !== undefined && { via: args.via }),
    });
    const judged = judge({ worksitePath: args.worksitePath, reportId: report.reportId });
    return {
      status: "ok",
      state: judged.status === "ok" ? judged.state : report,
      note: `既に記録済みの差分確認(${existing.fromSha.slice(0, 7)} → ${to.slice(0, 7)}: ${existing.note})。記録し直さない`,
      nextSteps: judged.status === "ok" && judged.state.state === "passed" ? ["submit"] : [],
    };
  }
  if (to === from) {
    return reject(
      `差分がない(${from.slice(0, 7)} は検証したソースと同じ)`,
      "検証したソースと HEAD は一致しています。そのまま submit できます",
      report.reportId,
    );
  }
  if (!isAncestor(args.worksitePath, from, to)) {
    return reject(
      `検証したソース(${from.slice(0, 7)})が ${to.slice(0, 7)} の祖先ではない(別ブランチ・rebase・巻き戻しのどれか)`,
      "報告の作業ブランチをチェックアウトしているか確認してください。rebase・巻き戻しなら差分確認の対象外です — いまのソースで証拠を取り直して judge し直してください",
      report.reportId,
    );
  }

  const commits = commitsBetween(args.worksitePath, from, to);
  report.deltaConfirms = [
    ...(report.deltaConfirms ?? []),
    { fromSha: from, toSha: to, note, confirmedAt: new Date().toISOString() },
  ];
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  appendEvent(gateDir, {
    tool: "confirm_delta",
    result: "ok",
    reportId: report.reportId,
    fromSha: from,
    toSha: to,
    commits: commits.length,
    ...(args.via !== undefined && { via: args.via }),
  });

  // 差分確認も人間確認と同じく、記録したら決定論の再判定で報告を前へ進める
  const judged = judge({ worksitePath: args.worksitePath, reportId: report.reportId });
  const head = `差分確認を記録した: ${from.slice(0, 7)} → ${to.slice(0, 7)}(${commits.length}コミットを人間が引き受け)`;
  if (judged.status === "rejected") {
    return { status: "ok", state: report, note: `${head}が、再判定は拒否された: ${judged.reason}`, nextSteps: [] };
  }
  return {
    status: "ok",
    state: judged.state,
    note: `${head}。${judged.note ?? ""}`,
    nextSteps: judged.state.state === "passed" ? ["submit"] : [],
  };
}
