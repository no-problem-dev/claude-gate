import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { evidenceFilePath, overview, repoDetail, submittedRecord } from "../src/kernel/api.js";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { judge } from "../src/ios/tools/judge.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { registerBuild } from "../src/ios/tools/register_build.js";
import { submit } from "../src/ios/tools/submit.js";

// ダッシュボードの読み取りモデル: ツールが作った状態がそのまま人間向けに読めること

let worksite: string;
let app: string;
let screenshot: string;

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  execFileSync("git", ["-C", worksite, "init", "-q"]);
  const artifacts = mkdtempSync(join(tmpdir(), "gate-artifacts-"));
  app = join(artifacts, "Sample.app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "Info.plist"), "<plist>sample</plist>");
  writeFileSync(join(app, "Sample"), "binary");
  screenshot = join(artifacts, "screen.png");
  writeFileSync(screenshot, "png-bytes");
});

function populate(): { repoKey: string; buildId: string; evidenceId: string } {
  const report = openReport({
    worksitePath: worksite,
    title: "あいさつ表示",
    behaviors: [{ behavior: "日付が出る", change_kind: "appearance", check: "screenshot" }],
  });
  const build = registerBuild({ worksitePath: worksite, appPath: app });
  if (report.status !== "ok" || build.status !== "ok") throw new Error("expected ok");
  const evidence = attachEvidence(
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
  if (evidence.status !== "ok") throw new Error("expected ok");
  const repos = overview().repos;
  return { repoKey: repos[0].repoKey, buildId: build.state.buildId, evidenceId: evidence.state.evidenceId };
}

describe("overview", () => {
  it("リポジトリごとの件数と最後のできごとが読める", () => {
    populate();
    const { repos } = overview();
    expect(repos.length).toBe(1);
    expect(repos[0].name).toBe(basename(worksite));
    expect(repos[0].reports).toBe(1);
    expect(repos[0].builds).toBe(1);
    expect(repos[0].evidence).toBe(1);
    expect(repos[0].unresolvedRejected).toBe(0);
    expect(repos[0].awaitingHuman).toBe(0);
    expect(repos[0].lastEvent).not.toBeNull();
  });
});

describe("repoDetail", () => {
  it("報告・ビルド・証拠・できごとが揃って返り、報告は証拠あり状態", () => {
    const { repoKey, buildId, evidenceId } = populate();
    const detail = repoDetail(repoKey);
    if (detail === null) throw new Error("expected detail");
    expect(detail.reports.length).toBe(1);
    expect(detail.reports[0].state).toBe("evidenced");
    expect(detail.reports[0].evidence[0]).toEqual({ evidenceId, behaviorIndex: 1 });
    expect(detail.builds[0].buildId).toBe(buildId);
    expect(detail.evidence[0].evidenceId).toBe(evidenceId);
    expect(detail.events.length).toBeGreaterThan(0);
  });

  it("証拠に帰属の逆引き(どの報告のどの動作を覆うか)が付く", () => {
    const { repoKey, evidenceId } = populate();
    const detail = repoDetail(repoKey);
    if (detail === null) throw new Error("expected detail");
    const item = detail.evidence.find((e) => e.evidenceId === evidenceId);
    expect(item?.usedBy).toEqual([
      { reportId: detail.reports[0].reportId, reportTitle: "あいさつ表示", behaviorIndex: 1 },
    ]);
  });

  it("未知の repoKey は null", () => {
    expect(repoDetail("ffffffffffff")).toBeNull();
  });
});

// 合格 → 提出済みまで通す(コミット済みのソース + スクショ証拠)
function submittedReport(): { repoKey: string; reportId: string; sha: string } {
  writeFileSync(join(worksite, "README.md"), "検証対象のソース");
  execFileSync("git", ["-C", worksite, "add", "-A"]);
  execFileSync("git", ["-C", worksite, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  const { repoKey } = populate();
  const detail = repoDetail(repoKey);
  if (detail === null) throw new Error("expected detail");
  const reportId = detail.reports[0].reportId;
  const judged = judge({ worksitePath: worksite, reportId });
  if (judged.status !== "ok" || judged.state.state !== "passed") throw new Error(`expected passed: ${JSON.stringify(judged)}`);
  const result = submit({ worksitePath: worksite, reportId });
  if (result.status !== "ok") throw new Error("expected ok");
  return { repoKey, reportId, sha: judged.state.judgment?.sourceSha ?? "" };
}

function setOriginMain(ref: string): void {
  execFileSync("git", ["-C", worksite, "update-ref", "refs/remotes/origin/main", ref]);
  execFileSync("git", ["-C", worksite, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
}

describe("取り込みの状態(導出)", () => {
  it("受け入れた sha が origin のデフォルトブランチに入っていれば「入った」", () => {
    const { repoKey, sha } = submittedReport();
    setOriginMain(sha);
    const detail = repoDetail(repoKey);
    expect(detail?.reports[0].adoption).toEqual({ defaultBranch: "main", entered: true });
  });

  it("入っていなければ取り込み待ち(entered: false)", () => {
    const { repoKey, sha } = submittedReport();
    // origin/main を受け入れた sha を含まない別系譜のコミットに向ける
    const orphan = execFileSync(
      "git",
      ["-C", worksite, "commit-tree", `${sha}^{tree}`, "-m", "unrelated"],
      { encoding: "utf8" },
    ).trim();
    setOriginMain(orphan);
    const detail = repoDetail(repoKey);
    expect(detail?.reports[0].adoption).toEqual({ defaultBranch: "main", entered: false });
  });

  it("origin の参照が無ければ導出しない(確かめられないことを偽らない)", () => {
    const { repoKey } = submittedReport();
    const detail = repoDetail(repoKey);
    expect(detail?.reports[0].adoption).toBeUndefined();
  });
});

describe("submittedRecord(消費者向けの照会)", () => {
  it("受け入れた sha に一致する提出済みの報告を返す", () => {
    const { reportId, sha } = submittedReport();
    expect(submittedRecord(worksite, sha)).toEqual({ submitted: true, reportId, title: "あいさつ表示" });
  });

  it("一致しない sha・git リポジトリでないパスは「無い」", () => {
    const { sha } = submittedReport();
    expect(submittedRecord(worksite, sha.replace(/./g, "0")).submitted).toBe(false);
    expect(submittedRecord(tmpdir(), sha).submitted).toBe(false);
  });
});

describe("evidenceFilePath", () => {
  it("不変コピーの実パスを返し、不正な ID 形式は null", () => {
    const { repoKey, evidenceId } = populate();
    expect(evidenceFilePath(repoKey, evidenceId)).toContain(evidenceId);
    expect(evidenceFilePath("../etc", evidenceId)).toBeNull();
    expect(evidenceFilePath(repoKey, "not-hex")).toBeNull();
  });
});
