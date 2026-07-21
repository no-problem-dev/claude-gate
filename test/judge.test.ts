import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_CANNOT_SEE, DEFAULT_PASSLINE } from "../src/ios/defaults.js";
import { judgeReport } from "../src/ios/judge_core.js";
import type { JudgeInput } from "../src/ios/judge_core.js";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { judge } from "../src/ios/tools/judge.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { registerBuild } from "../src/ios/tools/register_build.js";
import { runCheck } from "../src/ios/tools/run_check.js";
import type { BehaviorEntry, Build, Evidence, Report } from "../src/ios/words.js";

// 判定のゴールデンテスト: 決定論のコア(judge_core)を入力組合せ → 期待判定で固定する。
// 後半はツール層(FSM の移動・判定結果の保存・証拠追加での無効化)

// --- コア: 入力を組み立てるヘルパ(pure function なのでファイルシステム不要) ---

function makeReport(behaviors: BehaviorEntry[], evidence: { evidenceId: string; behaviorIndex: number }[]): Report {
  return {
    reportId: "r00000000000",
    title: "ゴールデン",
    behaviors,
    state: "evidenced",
    evidence,
    buildIds: [],
    openedAt: "2026-07-19T00:00:00.000Z",
  };
}

function screenshotEvidence(id: string, buildId: string): Evidence {
  return { evidenceId: id, kind: "screenshot", storedFile: `/x/${id}.png`, attachedAt: "t", buildId };
}

function checkRunEvidence(
  id: string,
  check: "compile" | "unit_test" | "ui_test",
  exitCode: number,
  gitSha: string | null = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  dirty = false,
): Evidence {
  return { evidenceId: id, kind: "check_run", storedFile: `/x/${id}.log`, attachedAt: "t", check, command: "cmd", exitCode, gitSha, dirty };
}

function cleanBuild(buildId: string, gitSha: string | null = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"): Build {
  return { buildId, buildIdFull: buildId.repeat(2), appPath: "/x/App.app", gitSha, dirty: false, machoUuids: [], registeredAt: "t" };
}

function deviceReportEvidence(id: string, buildId: string): Evidence {
  return { evidenceId: id, kind: "device_report", storedFile: `/x/${id}.log`, attachedAt: "t", buildId };
}

function input(partial: Partial<JudgeInput> & Pick<JudgeInput, "report">): JudgeInput {
  return {
    evidenceById: {},
    buildsById: {},
    passline: DEFAULT_PASSLINE,
    cannotSee: BUNDLED_CANNOT_SEE,
    ...partial,
  };
}

describe("judgeReport — ゴールデン", () => {
  it("全動作が適合証拠で覆われ、出所が揃っていれば 合格", () => {
    const report = makeReport(
      [
        { behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" },
        { behavior: "あいさつ計算が正しい", change_kind: "logic", check: "unit_test" },
      ],
      [
        { evidenceId: "e1", behaviorIndex: 1 },
        { evidenceId: "e2", behaviorIndex: 2 },
      ],
    );
    report.buildIds = ["b1"];
    const result = judgeReport(
      input({
        report,
        evidenceById: { e1: screenshotEvidence("e1", "b1"), e2: checkRunEvidence("e2", "unit_test", 0) },
        buildsById: { b1: cleanBuild("b1") },
      }),
    );
    expect(result.verdict).toBe("passed");
    expect(result.behaviors.map((b) => b.verdict)).toEqual(["ok", "ok"]);
    expect(result.reasons).toEqual([]);
  });

  it("証拠で覆われていない動作があれば 不合格(K-1)", () => {
    const report = makeReport([{ behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" }], []);
    const result = judgeReport(input({ report }));
    expect(result.verdict).toBe("failed");
    expect(result.behaviors[0].reason).toContain("覆われていない");
  });

  it("確かめ方に適合しない証拠では覆えない(スクショ宣言に ui_snapshot だけ)", () => {
    const report = makeReport(
      [{ behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const uiSnapshot: Evidence = { evidenceId: "e1", kind: "ui_snapshot", storedFile: "/x/e1.json", attachedAt: "t", buildId: "b1" };
    const result = judgeReport(input({ report, evidenceById: { e1: uiSnapshot } }));
    expect(result.verdict).toBe("failed");
  });

  it("赤い確かめ(終了コード非0)しか無い動作は 不合格", () => {
    const report = makeReport(
      [{ behavior: "計算が正しい", change_kind: "logic", check: "unit_test" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const result = judgeReport(input({ report, evidenceById: { e1: checkRunEvidence("e1", "unit_test", 1) } }));
    expect(result.verdict).toBe("failed");
    expect(result.behaviors[0].reason).toContain("赤");
  });

  it("合格ラインを下回る確かめ方は NG(K-7。passline 変更後の旧報告)", () => {
    const report = makeReport(
      [{ behavior: "タスクを追加できる", change_kind: "interaction", check: "screenshot" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const result = judgeReport(input({ report, evidenceById: { e1: screenshotEvidence("e1", "b1") } }));
    expect(result.verdict).toBe("failed");
    expect(result.behaviors[0].reason).toContain("下回る");
  });

  it("human_check の動作は 確認できず(機械は確認したことにしない)", () => {
    const report = makeReport([{ behavior: "課金して広告が消える", change_kind: "system", check: "human_check" }], []);
    const result = judgeReport(input({ report }));
    expect(result.verdict).toBe("unconfirmed");
    expect(result.behaviors[0].reason).toContain("人間に渡す");
  });

  it("見えないこと台帳に一致する動作は、証拠が付いていても 確認できず に変換(K-3)", () => {
    const report = makeReport(
      [{ behavior: "購入ボタンでペイウォールが開く", change_kind: "interaction", check: "interaction_log" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const uiSnapshot: Evidence = { evidenceId: "e1", kind: "ui_snapshot", storedFile: "/x/e1.json", attachedAt: "t", buildId: "b1" };
    const result = judgeReport(input({ report, evidenceById: { e1: uiSnapshot } }));
    expect(result.verdict).toBe("unconfirmed");
    expect(result.behaviors[0].reason).toContain("確認できない");
  });

  it("動き(motion)は録画があっても 確認できず(質の合否は人間)", () => {
    const report = makeReport(
      [{ behavior: "リストがなめらかにスクロールする", change_kind: "motion", check: "video" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const video: Evidence = { evidenceId: "e1", kind: "video", storedFile: "/x/e1.mov", attachedAt: "t", buildId: "b1" };
    const result = judgeReport(input({ report, evidenceById: { e1: video }, buildsById: { b1: cleanBuild("b1") } }));
    expect(result.verdict).toBe("unconfirmed");
    expect(result.behaviors[0].reason).toContain("人間");
  });

  it("実機レポート(device_report)で覆われた system の動作は 合格(実機 E2E を同格に扱う)", () => {
    const report = makeReport(
      [{ behavior: "keychain のログインが実機で復元される", change_kind: "system", check: "device_report" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    report.buildIds = ["b1"];
    const result = judgeReport(
      input({
        report,
        evidenceById: { e1: deviceReportEvidence("e1", "b1") },
        buildsById: { b1: cleanBuild("b1") },
      }),
    );
    expect(result.verdict).toBe("passed");
    expect(result.sourceSha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("device_report を宣言したのにスクショしか無いと 不合格(実機レポートでのみ覆える)", () => {
    const report = makeReport(
      [{ behavior: "課金が実機で通る", change_kind: "system", check: "device_report" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const result = judgeReport(input({ report, evidenceById: { e1: screenshotEvidence("e1", "b1") } }));
    expect(result.verdict).toBe("failed");
    expect(result.behaviors[0].reason).toContain("覆われていない");
  });

  it("旧形式(変更の種類なし)は 確認できず", () => {
    const report = makeReport(
      [{ behavior: "日付が表示される", check: "screenshot" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const result = judgeReport(input({ report, evidenceById: { e1: screenshotEvidence("e1", "b1") } }));
    expect(result.verdict).toBe("unconfirmed");
    expect(result.behaviors[0].reason).toContain("旧形式");
  });

  it("複数ビルドの証拠が混在していたら、全動作 OK でも 確認できず(同一ビルド要件)", () => {
    const report = makeReport(
      [
        { behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" },
        { behavior: "あいさつが表示される", change_kind: "appearance", check: "screenshot" },
      ],
      [
        { evidenceId: "e1", behaviorIndex: 1 },
        { evidenceId: "e2", behaviorIndex: 2 },
      ],
    );
    const result = judgeReport(
      input({
        report,
        evidenceById: { e1: screenshotEvidence("e1", "b1"), e2: screenshotEvidence("e2", "b2") },
        buildsById: { b1: cleanBuild("b1"), b2: cleanBuild("b2") },
      }),
    );
    expect(result.verdict).toBe("unconfirmed");
    expect(result.behaviors.map((b) => b.verdict)).toEqual(["ok", "ok"]);
    expect(result.reasons.join()).toContain("混在");
  });

  it("dirty なソースで実行した確かめが混ざっていたら 確認できず", () => {
    const report = makeReport(
      [{ behavior: "計算が正しい", change_kind: "logic", check: "unit_test" }],
      [{ evidenceId: "e1", behaviorIndex: 1 }],
    );
    const result = judgeReport(
      input({ report, evidenceById: { e1: checkRunEvidence("e1", "unit_test", 0, "aaa", true) } }),
    );
    expect(result.verdict).toBe("unconfirmed");
    expect(result.reasons.join()).toContain("未コミット");
  });

  it("取り直し前の古い緑が別ソースでも、覆いは動作ごとに最新の1件(実運用で発見した回帰)", () => {
    // HEAD を動かして run_check を取り直すと、古い緑と新しい緑が別ソースになる。
    // 全部を覆いに数えると同一ソース要件が永久に破られ、submit の fix が実行不能になる
    const report = makeReport(
      [{ behavior: "計算が正しい", change_kind: "logic", check: "unit_test" }],
      [
        { evidenceId: "old", behaviorIndex: 1 },
        { evidenceId: "new", behaviorIndex: 1 },
      ],
    );
    const oldRun = { ...checkRunEvidence("old", "unit_test", 0, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), attachedAt: "2026-07-19T01:00:00Z" };
    const newRun = { ...checkRunEvidence("new", "unit_test", 0, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), attachedAt: "2026-07-19T02:00:00Z" };
    const result = judgeReport(input({ report, evidenceById: { old: oldRun, new: newRun } }));
    expect(result.verdict).toBe("passed");
    expect(result.sourceSha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("スクショのビルドとテスト実行のソースが一致しなければ 確認できず", () => {
    const report = makeReport(
      [
        { behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" },
        { behavior: "計算が正しい", change_kind: "logic", check: "unit_test" },
      ],
      [
        { evidenceId: "e1", behaviorIndex: 1 },
        { evidenceId: "e2", behaviorIndex: 2 },
      ],
    );
    const result = judgeReport(
      input({
        report,
        evidenceById: {
          e1: screenshotEvidence("e1", "b1"),
          e2: checkRunEvidence("e2", "unit_test", 0, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        },
        buildsById: { b1: cleanBuild("b1") }, // ビルドは aaa… のソース
      }),
    );
    expect(result.verdict).toBe("unconfirmed");
    expect(result.reasons.join()).toContain("一致しない");
  });
});

// --- ツール層: FSM の移動・判定結果の保存・証拠追加での無効化 ---

let worksite: string;
let app: string;
let screenshot: string;

function repoDir(): string {
  const reposRoot = join(process.env.GATE_HOME as string, "repos");
  return join(reposRoot, execFileSync("ls", [reposRoot], { encoding: "utf8" }).trim());
}

function readReportFile(reportId: string): Report {
  return JSON.parse(readFileSync(join(repoDir(), "reports", `${reportId}.json`), "utf8")) as Report;
}

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  execFileSync("git", ["-C", worksite, "init", "-q"]);
  writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo all-green"\n');
  execFileSync("git", ["-C", worksite, "add", "-A"]);
  execFileSync("git", ["-C", worksite, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  const artifacts = mkdtempSync(join(tmpdir(), "gate-artifacts-"));
  app = join(artifacts, "Sample.app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "Info.plist"), "<plist>sample</plist>");
  writeFileSync(join(app, "Sample"), "binary");
  screenshot = join(artifacts, "screen.png");
  writeFileSync(screenshot, "png-bytes");
});

describe("judge — ツール層", () => {
  function fullFlow(): { reportId: string; buildId: string } {
    const report = openReport({
      worksitePath: worksite,
      title: "判定フロー",
      behaviors: [
        { behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" },
        { behavior: "あいさつ計算が正しい", change_kind: "logic", check: "unit_test" },
      ],
    });
    const build = registerBuild({ worksitePath: worksite, appPath: app });
    if (report.status !== "ok" || build.status !== "ok") throw new Error("expected ok");
    const attached = attachEvidence(
      {
        worksitePath: worksite,
        buildId: build.state.buildId,
        kind: "screenshot",
        file: screenshot,
        simulatorUdid: "UDID-TEST",
        bundleId: "com.example.sample",
        reportId: report.state.reportId,
        behaviorIndex: 1,
      },
      { installedAppPath: () => app },
    );
    const ran = runCheck({
      worksitePath: worksite,
      check: "unit_test",
      reportId: report.state.reportId,
      behaviorIndex: 2,
    });
    if (attached.status !== "ok" || ran.status !== "ok") throw new Error("expected ok");
    return { reportId: report.state.reportId, buildId: build.state.buildId };
  }

  it("実フロー(スクショ + ゲート実行のテスト)で 合格 になり、判定が保存される", () => {
    const { reportId } = fullFlow();
    const result = judge({ worksitePath: worksite, reportId });
    if (result.status !== "ok") throw new Error(`expected ok: ${JSON.stringify(result)}`);
    expect(result.state.state).toBe("passed");
    const saved = readReportFile(reportId);
    expect(saved.judgment?.verdict).toBe("passed");
    expect(saved.judgment?.behaviors.map((b) => b.verdict)).toEqual(["ok", "ok"]);
  });

  it("証拠ゼロ(下書き)の報告は判定できない", () => {
    const report = openReport({
      worksitePath: worksite,
      title: "下書きのみ",
      behaviors: [{ behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" }],
    });
    if (report.status !== "ok") throw new Error("expected ok");
    const result = judge({ worksitePath: worksite, reportId: report.state.reportId });
    expect(result.status).toBe("rejected");
  });

  it("判定後に証拠を足すと 証拠あり に戻り、判定結果は消える(古い判定を残さない)", () => {
    const { reportId, buildId } = fullFlow();
    judge({ worksitePath: worksite, reportId });
    expect(readReportFile(reportId).state).toBe("passed");

    const another = join(mkdtempSync(join(tmpdir(), "gate-art2-")), "screen2.png");
    writeFileSync(another, "png-bytes-2");
    const attached = attachEvidence(
      {
        worksitePath: worksite,
        buildId,
        kind: "screenshot",
        file: another,
        simulatorUdid: "UDID-TEST",
        bundleId: "com.example.sample",
        reportId,
        behaviorIndex: 1,
      },
      { installedAppPath: () => app },
    );
    if (attached.status !== "ok") throw new Error("expected ok");
    const saved = readReportFile(reportId);
    expect(saved.state).toBe("evidenced");
    expect(saved.judgment).toBeUndefined();

    const again = judge({ worksitePath: worksite, reportId });
    if (again.status !== "ok") throw new Error("expected ok");
    expect(again.state.state).toBe("passed"); // 再判定は常に可
  });
});

describe("judgeReport — 人間確認(human_check 証拠)", () => {
  const humanCheckEvidence = (id: string, note: string): Evidence => ({
    evidenceId: id,
    kind: "human_check",
    storedFile: `/x/${id}.txt`,
    note,
    attachedAt: "t",
  });

  it("human_check 宣言の動作は、人間確認の証拠が付いたら OK(付かなければ 確認できず)", () => {
    const behaviors: BehaviorEntry[] = [{ behavior: "課金フローが通る", change_kind: "system", check: "human_check" }];
    const before = judgeReport(input({ report: makeReport(behaviors, []) }));
    expect(before.behaviors[0].verdict).toBe("unconfirmed");

    const after = judgeReport(
      input({
        report: makeReport(behaviors, [{ evidenceId: "h1", behaviorIndex: 1 }]),
        evidenceById: { h1: humanCheckEvidence("h1", "Xcode Run で購入まで確認") },
      }),
    );
    expect(after.behaviors[0].verdict).toBe("ok");
    expect(after.behaviors[0].reason).toContain("人間が確認した");
    expect(after.verdict).toBe("passed");
  });

  it("見えないこと台帳に一致する動作も、人間確認の証拠で OK になる", () => {
    const behaviors: BehaviorEntry[] = [
      { behavior: "課金の導線が開く", change_kind: "interaction", check: "interaction_log" },
    ];
    const result = judgeReport(
      input({
        report: makeReport(behaviors, [{ evidenceId: "h1", behaviorIndex: 1 }]),
        evidenceById: { h1: humanCheckEvidence("h1", "実機で購入シートを確認") },
      }),
    );
    expect(result.behaviors[0].verdict).toBe("ok");
  });

  it("動き(motion)の動作も、人間確認の証拠で OK になる", () => {
    const behaviors: BehaviorEntry[] = [{ behavior: "完了の演出が滑らか", change_kind: "motion", check: "video" }];
    const result = judgeReport(
      input({
        report: makeReport(behaviors, [{ evidenceId: "h1", behaviorIndex: 1 }]),
        evidenceById: { h1: humanCheckEvidence("h1", "録画を見て動きを確認") },
      }),
    );
    expect(result.behaviors[0].verdict).toBe("ok");
  });
});
