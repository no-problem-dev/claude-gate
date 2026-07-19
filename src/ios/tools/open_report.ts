import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import type { BehaviorEntry, Reply, Report } from "../words.js";

export interface OpenReportArgs {
  worksitePath: string;
  title: string;
  behaviors: BehaviorEntry[];
}

// 報告を開く。動作一覧が空の報告は作れない(A3: 実行なき完了報告を型で防ぐ)。
// reportId は repoKey + 作業名から計算(D3: 乱数禁止)。同じ作業名の再呼び出しはべき等。
export function openReport(args: OpenReportArgs): Reply<Report> {
  const gateDir = repoDirOf(args.worksitePath);
  const reject = (reason: string, fix: string): Reply<Report> => {
    appendEvent(gateDir, { tool: "open_report", result: "rejected", reason });
    return { status: "rejected", reason, fix, nextSteps: ["open_report"] };
  };

  const title = args.title.trim();
  if (title.length === 0) {
    return reject("作業名が空", "日本語の作業名(例「時間帯あいさつ+日付表示」)を渡してください");
  }
  if (args.behaviors.length === 0) {
    return reject(
      "動作一覧が空の報告は作れない",
      "動くと言っている動作を1つ以上、確かめ方とあわせて宣言してください",
    );
  }
  const blank = args.behaviors.findIndex((b) => b.behavior.trim().length === 0 || b.check.trim().length === 0);
  if (blank !== -1) {
    return reject(
      `動作一覧の ${blank + 1} 行目が空(動作と確かめ方の両方が必要)`,
      "各行に「動くと言っている動作(文)」と「使う確かめ方」を書いてください",
    );
  }

  const behaviors = args.behaviors.map((b) => ({ behavior: b.behavior.trim(), check: b.check.trim() }));
  const repoKey = basename(gateDir);
  const reportId = createHash("sha256").update(`${repoKey}\0${title}`).digest("hex").slice(0, 12);
  const recordPath = join(gateDir, "reports", `${reportId}.json`);

  const existing = readJson<Report>(recordPath);
  if (existing !== null) {
    const same = JSON.stringify(existing.behaviors) === JSON.stringify(behaviors);
    if (!same) {
      return reject(
        `作業名「${title}」の報告は既に開いていて、動作一覧はオープン時に固定`,
        "別の作業名で新しい報告を開くか、既存の報告(番号は既存の動作一覧のまま)に証拠を付けてください",
      );
    }
    appendEvent(gateDir, { tool: "open_report", result: "ok", reportId, alreadyOpened: true });
    return {
      status: "ok",
      state: existing,
      note: `既オープンの報告(オープン: ${existing.openedAt})。動作一覧は最初の宣言のまま`,
      nextSteps: ["register_build", "attach_evidence"],
    };
  }

  const report: Report = {
    reportId,
    title,
    behaviors,
    state: "draft",
    evidence: [],
    buildIds: [],
    openedAt: new Date().toISOString(),
  };
  writeJson(recordPath, report);
  appendEvent(gateDir, { tool: "open_report", result: "ok", reportId });
  return { status: "ok", state: report, nextSteps: ["register_build", "attach_evidence"] };
}
