import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { repoDirOf, writeJson } from "../../kernel/store.js";
import { branchTip, gitDirty, gitSha } from "../git.js";
import { prReady, prView, resolveGh } from "../github.js";
import { readReport } from "../report_link.js";
import type { Reply, Report } from "../words.js";

// 提出する: 合格した報告の、検証されたそのソースの下書きPR だけがレビュー可能にできる(A7 / K-5)。
// 合格だけでは足りない — 判定が検証したソース(sourceSha)と報告の作業ブランチ先端と PR 先頭の三点照合を通す。
// 検証後に積んだ・巻き戻したソースの提出は「別物を見て OK」の提出版として拒否する。
// 人間の動きは非同期: 照合と push はブランチ基準で、ローカルのチェックアウト・worktree・未コミット変更に依存しない
// (旧形式 = ブランチ記録の無い報告だけ、従来どおり作業場の HEAD を基準にする)。
// 共有(feature ブランチへの push・下書きPR の作成)は自由領域、取り込み(merge)は人間だけ(words.ts の境界線)。

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
    return {
      status: "ok",
      state: report,
      note: `既提出の報告(提出: ${report.submission?.readiedAt ?? report.submission?.pushedAt})。提出はし直さない`,
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
  let branch: string;
  let pushRef: string;
  if (report.branch !== undefined) {
    // ブランチ基準の照合: sourceSha = ブランチ先端。ローカルのチェックアウト・未コミット変更は見ない
    branch = report.branch;
    pushRef = `refs/heads/${branch}`;
    const tip = branchTip(args.worksitePath, branch);
    if (tip === null) {
      return reject(
        `作業ブランチ「${branch}」が見つからない`,
        "ブランチが削除・改名されていないか確認してください",
        ["submit"],
      );
    }
    if (tip !== sourceSha) {
      return reject(
        `ブランチ ${branch} の先端(${tip.slice(0, 7)})が検証したソース(${sourceSha.slice(0, 7)})と違う`,
        "検証後にコミットが積まれています。いまの先端で証拠を取り直して judge し直すか、人間が差分を見て引き受けてください(差分確認)",
        ["run_check", "attach_evidence", "judge"],
      );
    }
  } else {
    // 旧形式(ブランチ記録なし): 作業場の HEAD 基準
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
    pushRef = "HEAD";
    try {
      branch = execFileSync("git", ["-C", args.worksitePath, "rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
      }).trim();
    } catch (error) {
      return reject(`ブランチ名を取得できない: ${String(error)}`, "worksitePath を確認してください", ["submit"]);
    }
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
    execFileSync("git", ["-C", args.worksitePath, "push", remote, pushRef], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    return reject(`push が失敗した: ${stderr.trim()}`, "reason の git エラーを解消してから提出し直してください", [
      "submit",
    ]);
  }

  const gh = resolveGh();
  if (gh === null) {
    return reject(
      "GitHub CLI(gh)が見つからない",
      "gh をインストールし gh auth login を済ませてから提出し直してください",
      ["submit"],
    );
  }
  const lookup = prView(gh, args.worksitePath, report.branch);
  if (lookup.status === "none") {
    return reject(
      `このブランチ(${branch})の PR が無い`,
      "gh pr create --draft で下書きPR を作ってから submit し直してください(下書きPR の作成は自由領域)",
      ["submit"],
    );
  }
  if (lookup.status === "error") {
    return reject(
      `gh の実行に失敗した: ${lookup.detail}`,
      "gh auth status で認証を確認してから提出し直してください",
      ["submit"],
    );
  }
  const pr = lookup.pr;
  if (pr.state !== "OPEN") {
    return reject(
      `PR #${pr.number} が${pr.state === "MERGED" ? "取り込み済み" : "閉じられている"}`,
      "続きの作業は新しいブランチ + 下書きPR で開き直してください",
      ["open_report"],
    );
  }
  if (pr.headRefOid !== sourceSha) {
    return reject(
      `PR #${pr.number} の先頭(${pr.headRefOid.slice(0, 7)})が検証したソース(${sourceSha.slice(0, 7)})と違う`,
      "PR のブランチと作業ブランチが一致しているか確認し、push の反映後に submit し直してください",
      ["submit"],
    );
  }
  let note: string;
  if (pr.isDraft) {
    const readied = prReady(gh, args.worksitePath, pr.number);
    if (!readied.ok) {
      return reject(
        `ドラフト解除に失敗した: ${readied.detail}`,
        "gh auth status と PR への権限を確認してから提出し直してください",
        ["submit"],
      );
    }
    note = `提出した: PR #${pr.number} をレビュー可能にした(検証したソース ${sourceSha.slice(0, 7)} = HEAD = PR 先頭)。この報告は終着 — 続きは新しい作業名で`;
  } else {
    note = `PR #${pr.number} は既にレビュー可能だった(照合は通っているので記録だけ残す)。この報告は終着 — 続きは新しい作業名で`;
  }

  report.state = "submitted";
  report.submission = {
    sha: sourceSha,
    branch,
    remote,
    prNumber: pr.number,
    prUrl: pr.url,
    readiedAt: new Date().toISOString(),
  };
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  // 原因のできごとが結果(報告の状態)を運ぶ。独立した report_state 行は書かない
  appendEvent(gateDir, {
    tool: "submit",
    result: "ok",
    reportId: report.reportId,
    sha: sourceSha,
    branch,
    prNumber: pr.number,
    reportState: "submitted",
    ...(args.via !== undefined && { via: args.via }),
  });
  return { status: "ok", state: report, note, nextSteps: [] };
}
