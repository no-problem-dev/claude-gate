import { CHANGE_KIND_LABEL, CHECK_LABEL } from "./words.js";
import type {
  BehaviorVerdict,
  Build,
  CannotSeeEntry,
  CheckKind,
  Evidence,
  Passline,
  Report,
  Verdict,
} from "./words.js";

// 判定のコア: 決定論の pure function(報告 + 証拠 + ビルド + 合格ライン + 台帳 → 判定)。
// LLM なし・時刻なし・読み書きなし。ゴールデンテストで固定する。
// 守備範囲は「宣言が受理済み証拠で覆われたか」まで。宣言の質・テストの正しさは人間の領分

export interface JudgeInput {
  report: Report;
  evidenceById: Record<string, Evidence>;
  buildsById: Record<string, Build>;
  passline: Passline;
  cannotSee: CannotSeeEntry[];
}

export interface JudgeResult {
  verdict: "passed" | "failed" | "unconfirmed";
  behaviors: BehaviorVerdict[];
  reasons: string[];
  sourceSha: string | null;
}

// 確かめ方 → 適合する証拠の種類(覆いの照合表)
function covers(check: CheckKind, e: Evidence): boolean {
  switch (check) {
    case "compile":
    case "unit_test":
    case "ui_test":
      return e.kind === "check_run" && e.check === check;
    case "screenshot":
      return e.kind === "screenshot";
    case "interaction_log":
      return e.kind === "ui_snapshot" || e.kind === "video";
    case "video":
      return e.kind === "video";
    case "launch_check":
      return e.kind === "screenshot" || e.kind === "video";
    case "device_report":
      return e.kind === "device_report"; // 実機セルフレポートは実機レポートでのみ覆える
    case "human_check":
      return e.kind === "human_check"; // 人間確認の証拠(CLI confirm。人間だけが作れる)でのみ覆える
  }
}

export function judgeReport(input: JudgeInput): JudgeResult {
  const { report, evidenceById, buildsById, passline, cannotSee } = input;
  const behaviors: BehaviorVerdict[] = [];
  const covering: Evidence[] = []; // 覆いに使った証拠(報告レベルの照合の対象)

  for (const [i, entry] of report.behaviors.entries()) {
    const index = i + 1;
    const push = (verdict: Verdict, reason?: string) => behaviors.push({ index, verdict, reason });

    // 1. 旧形式(変更の種類なし)は下限と比較できない
    if (entry.change_kind === undefined) {
      push("unconfirmed", "変更の種類が宣言されていない(2b 以前の旧形式)。新しい作業名で開き直してください");
      continue;
    }
    // 2. K-7: 確かめ方が合格ラインを下回る(open_report が防ぐので、旧報告か passline 変更後のみ)
    if (!passline[entry.change_kind].includes(entry.check)) {
      const allowed = passline[entry.change_kind].map((c) => CHECK_LABEL[c]).join(" / ");
      push(
        "ng",
        `確かめ方「${CHECK_LABEL[entry.check]}」は変更の種類「${CHANGE_KIND_LABEL[entry.change_kind]}」の合格ラインを下回る(使えるのは ${allowed})`,
      );
      continue;
    }
    const linked = report.evidence
      .filter((l) => l.behaviorIndex === index)
      .map((l) => evidenceById[l.evidenceId])
      .filter((e): e is Evidence => e !== undefined);

    // 3. 人間確認の証拠(人間だけが作れる)が付いた動作は OK — 人間は最上位の検証器。
    // 機械に見えない経路(human_check 宣言・見えないこと台帳・動きの質)は全てこれで解決する。
    // 人間確認は出所照合の対象にしない(覆い covering に入れない — 人間の判断そのもの)
    const humanConfirms = linked.filter((e) => e.kind === "human_check");
    if (humanConfirms.length > 0) {
      const latest = humanConfirms.reduce((a, b) => (a.attachedAt >= b.attachedAt ? a : b));
      push("ok", `人間が確認した${latest.note !== undefined ? `: ${latest.note}` : ""}`);
      continue;
    }
    if (entry.check === "human_check") {
      push("unconfirmed", "人間確認の動作。機械は確認できない — 人間に渡す(確認したら claude-gate confirm)");
      continue;
    }
    // 4. K-3: 見えないこと台帳に一致する動作は、証拠が付いていても OK に潰さない
    const blind = cannotSee.find(
      (c) => c.checks.includes(entry.check) && c.keywords.some((k) => entry.behavior.includes(k)),
    );
    if (blind !== undefined) {
      push("unconfirmed", `この確かめ方では確認できない: ${blind.reason} → ${blind.instead}`);
      continue;
    }
    // 5. K-1: 紐づいた受理済み証拠のうち、確かめ方に適合するもので覆われているか。
    // 覆いに使うのは動作ごとに「最新の適合証拠1件」だけ: 記録は積み上がる一方(不変)なので、
    // 全部を覆いに数えると、取り直し前の古い証拠が同一ソース要件を永久に破る(実際に起きた)。
    // 判定が答えるのは「最新の検証が何を見たか」
    const matched = linked.filter((e) => covers(entry.check, e));
    const okCovers = matched.filter((e) => e.kind !== "check_run" || e.exitCode === 0);
    if (okCovers.length === 0) {
      if (matched.length > 0) {
        push("ng", `確かめが赤(終了コード ${matched.map((e) => e.exitCode).join(", ")})。直してから実行し直す`);
      } else {
        push("ng", `適合する証拠で覆われていない(必要: ${CHECK_LABEL[entry.check]})`);
      }
      continue;
    }
    const latest = okCovers.reduce((a, b) => (a.attachedAt >= b.attachedAt ? a : b));
    covering.push(latest);
    // 6. 動きの質は機械に見えない: 録画の存在と出所までを機械が確かめ、合否は人間
    if (entry.change_kind === "motion") {
      push("unconfirmed", "録画は受理済み。動きの質の合否は人間が判断する(確認したら claude-gate confirm)");
      continue;
    }
    // 7. 覆われている
    push("ok");
  }

  // 報告レベル: 動作が全部 OK でも、証拠の出所が揃わなければ合格を「確認できず」に抑える
  const reasons: string[] = [];
  const simObs = covering.filter((e) => e.kind !== "check_run");
  const checkRuns = covering.filter((e) => e.kind === "check_run");

  const simBuildIds = [...new Set(simObs.map((e) => e.buildId))];
  if (simBuildIds.length > 1) {
    reasons.push(
      `複数ビルドの証拠が混在(${simBuildIds.join(", ")})。最新ビルドで全動作が動くことの確認になっていない`,
    );
  }
  if (checkRuns.some((e) => e.dirty === true)) {
    reasons.push("未コミット変更ありのソースで実行した確かめが混ざっていて、どのソースの結果か確定できない");
  }
  const runShas = [...new Set(checkRuns.map((e) => e.gitSha ?? "no-commit"))];
  if (runShas.length > 1) {
    reasons.push(`確かめの実行が別々のソースにまたがっている(${runShas.map((s) => s.slice(0, 7)).join(", ")})`);
  }
  if (simObs.length > 0 && checkRuns.length > 0 && simBuildIds.length === 1 && runShas.length === 1) {
    const build = simBuildIds[0] !== undefined ? buildsById[simBuildIds[0]] : undefined;
    if (build === undefined) {
      reasons.push("証拠の由来ビルドの記録が見つからず、テスト実行と同一ソースか確認できない");
    } else if (build.dirty) {
      reasons.push("ビルドが未コミット変更ありのソースから作られていて、テスト実行と同一ソースか確認できない");
    } else if (build.gitSha !== checkRuns[0].gitSha) {
      reasons.push(
        `スクショ等のビルド(${(build.gitSha ?? "no-commit").slice(0, 7)})とテスト実行(${(checkRuns[0].gitSha ?? "no-commit").slice(0, 7)})のソースが一致しない`,
      );
    }
  }

  // 検証したソース(sourceSha): submit が HEAD と照合する。単一に確定しないときは null
  let sourceSha: string | null = null;
  if (checkRuns.length > 0 && runShas.length === 1 && !checkRuns.some((e) => e.dirty === true)) {
    sourceSha = checkRuns[0].gitSha ?? null;
  } else if (checkRuns.length === 0 && simBuildIds.length === 1 && simBuildIds[0] !== undefined) {
    const build = buildsById[simBuildIds[0]];
    if (build !== undefined && !build.dirty) sourceSha = build.gitSha;
  }

  const anyNg = behaviors.some((b) => b.verdict === "ng");
  const anyUnconfirmed = behaviors.some((b) => b.verdict === "unconfirmed");
  const verdict = anyNg ? "failed" : anyUnconfirmed || reasons.length > 0 ? "unconfirmed" : "passed";
  return { verdict, behaviors, reasons, sourceSha };
}
