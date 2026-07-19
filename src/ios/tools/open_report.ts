import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { effectivePassline, loadGateYaml } from "../gate_yaml.js";
import { CHANGE_KINDS, CHANGE_KIND_LABEL, CHECK_KINDS, CHECK_LABEL } from "../words.js";
import type { BehaviorEntry, ChangeKind, CheckKind, Reply, Report } from "../words.js";

export interface OpenReportArgs {
  worksitePath: string;
  title: string;
  behaviors: { behavior: string; change_kind: string; check: string }[];
}

const CHECK_VOCABULARY = CHECK_KINDS.map((kind) => `${kind}(${CHECK_LABEL[kind]})`).join(" / ");
const CHANGE_KIND_VOCABULARY = CHANGE_KINDS.map((kind) => `${kind}(${CHANGE_KIND_LABEL[kind]})`).join(" / ");

// 報告を開く。動作一覧が空の報告は作れない(A3: 実行なき完了報告を型で防ぐ)。
// 確かめ方が変更の種類の合格ラインを下回る計画では開けない(K-7 の前倒し)。
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
      "動くと言っている動作を1つ以上、変更の種類・確かめ方とあわせて宣言してください",
    );
  }
  const blank = args.behaviors.findIndex(
    (b) => b.behavior.trim().length === 0 || b.change_kind.trim().length === 0 || b.check.trim().length === 0,
  );
  if (blank !== -1) {
    return reject(
      `動作一覧の ${blank + 1} 行目が空(動作・変更の種類・確かめ方のすべてが必要)`,
      "各行に「動くと言っている動作(文)」「変更の種類」「使う確かめ方」を書いてください",
    );
  }
  // 変更の種類・確かめ方は語彙から選ぶ(自由文字列は判定で下限と機械比較できない)
  const unknownKind = args.behaviors.findIndex(
    (b) => !(CHANGE_KINDS as readonly string[]).includes(b.change_kind.trim()),
  );
  if (unknownKind !== -1) {
    return reject(
      `動作一覧の ${unknownKind + 1} 行目の変更の種類「${args.behaviors[unknownKind].change_kind}」が語彙にない`,
      `変更の種類は次から選んでください: ${CHANGE_KIND_VOCABULARY}`,
    );
  }
  const unknownCheck = args.behaviors.findIndex((b) => !(CHECK_KINDS as readonly string[]).includes(b.check.trim()));
  if (unknownCheck !== -1) {
    return reject(
      `動作一覧の ${unknownCheck + 1} 行目の確かめ方「${args.behaviors[unknownCheck].check}」が語彙にない`,
      `確かめ方は次から選んでください: ${CHECK_VOCABULARY}`,
    );
  }

  // 合格ライン照合(K-7 の前倒し): 変更の種類に対して使ってよい確かめ方か
  const yaml = loadGateYaml(args.worksitePath);
  if (yaml.error !== undefined) {
    return reject(yaml.error, "リポジトリの gate.yaml を直してください(全セクション任意。無くても動く)");
  }
  const passline = effectivePassline(yaml.config);
  const below = args.behaviors.findIndex(
    (b) => !passline[b.change_kind.trim() as ChangeKind].includes(b.check.trim() as CheckKind),
  );
  if (below !== -1) {
    const kind = args.behaviors[below].change_kind.trim() as ChangeKind;
    const allowed = passline[kind].map((c) => `${c}(${CHECK_LABEL[c]})`).join(" / ");
    return reject(
      `動作一覧の ${below + 1} 行目: 確かめ方「${args.behaviors[below].check}」は変更の種類「${CHANGE_KIND_LABEL[kind]}」の合格ラインを下回る`,
      `「${CHANGE_KIND_LABEL[kind]}」に使える確かめ方: ${allowed}。下限を下げる例外は人間が gate.yaml の passline を変更する(git に記録が残る)`,
    );
  }

  const behaviors: BehaviorEntry[] = args.behaviors.map((b) => ({
    behavior: b.behavior.trim(),
    change_kind: b.change_kind.trim() as ChangeKind,
    check: b.check.trim() as CheckKind,
  }));
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
