import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { repoDirOf, writeJson } from "../../kernel/store.js";
import { gitDirty, gitSha } from "../git.js";
import { readReport } from "../report_link.js";
import type { Reply, Report } from "../words.js";

// 提出する: 合格した報告の、検証されたそのソースだけが push できる(A7 / K-5)。
// 合格だけでは足りない — 判定が検証したソース(sourceSha)と HEAD の機械照合を通す。
// 検証後に積んだ・巻き戻したソースの push は「別物を見て OK」の提出版として拒否する。

export interface SubmitArgs {
  worksitePath: string;
  reportId: string;
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
    appendEvent(gateDir, { tool: "submit", result: "rejected", reportId: args.reportId, reason });
    return { status: "rejected", reason, fix, nextSteps };
  };

  const report = readReport(gateDir, args.reportId);
  if (report === null) {
    return reject(`報告 ${args.reportId} が未オープン`, "先に open_report で報告を開いてください", ["open_report"]);
  }
  if (report.state === "submitted") {
    appendEvent(gateDir, { tool: "submit", result: "ok", reportId: report.reportId, alreadySubmitted: true });
    return {
      status: "ok",
      state: report,
      note: `既提出の報告(提出: ${report.submission?.pushedAt})。push はし直さない`,
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
  if (gitDirty(args.worksitePath)) {
    return reject(
      "作業場に未コミットの変更がある(push されるのは HEAD で、いまの作業場と一致しない)",
      "コミットしてから提出してください",
      ["submit"],
    );
  }
  const head = gitSha(args.worksitePath);
  if (head !== sourceSha) {
    return reject(
      `HEAD(${head?.slice(0, 7) ?? "なし"})が検証したソース(${sourceSha.slice(0, 7)})と違う`,
      "検証後にコミットが動いています。いまの HEAD で証拠を取り直して judge → submit し直してください",
      ["run_check", "attach_evidence", "judge"],
    );
  }

  let branch: string;
  try {
    branch = execFileSync("git", ["-C", args.worksitePath, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return reject(`ブランチ名を取得できない: ${String(error)}`, "worksitePath を確認してください", ["submit"]);
  }
  const remote = "origin";
  try {
    execFileSync("git", ["-C", args.worksitePath, "remote", "get-url", remote], { stdio: "pipe" });
  } catch {
    return reject(
      `remote「${remote}」が設定されていない`,
      "git remote add origin <url> を設定してから提出してください",
      ["submit"],
    );
  }
  try {
    execFileSync("git", ["-C", args.worksitePath, "push", remote, "HEAD"], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    return reject(`push が失敗した: ${stderr.trim()}`, "reason の git エラーを解消してから提出し直してください", [
      "submit",
    ]);
  }

  report.state = "submitted";
  report.submission = { sha: sourceSha, branch, remote, pushedAt: new Date().toISOString() };
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  appendEvent(gateDir, { tool: "submit", result: "ok", reportId: report.reportId, sha: sourceSha, branch });
  appendEvent(gateDir, { tool: "report_state", result: "ok", reportId: report.reportId, state: "submitted" });
  return {
    status: "ok",
    state: report,
    note: `提出した: ${remote}/${branch} へ ${sourceSha.slice(0, 7)} を push(検証したソースと同一)。この報告は終着 — 続きは新しい作業名で`,
    nextSteps: [],
  };
}
