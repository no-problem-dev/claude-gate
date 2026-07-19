import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { evidenceFilePath, overview, repoDetail } from "../src/kernel/api.js";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { registerBuild } from "../src/ios/tools/register_build.js";

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
    expect(repos[0].rejected).toBe(0);
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

  it("未知の repoKey は null", () => {
    expect(repoDetail("ffffffffffff")).toBeNull();
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
