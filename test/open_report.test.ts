import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { registerBuild } from "../src/ios/tools/register_build.js";
import type { Report } from "../src/ios/words.js";

// 事故 A3 の対策: 動作一覧が空の報告は作れない。証拠は報告の動作に紐づく

let worksite: string;
let app: string;
let screenshot: string;

function repoDir(): string {
  const reposRoot = join(process.env.GATE_HOME as string, "repos");
  const keys = readdirSync(reposRoot);
  if (keys.length !== 1) throw new Error(`expected 1 repo, got ${keys.length}`);
  return join(reposRoot, keys[0]);
}

function readReport(reportId: string): Report {
  return JSON.parse(readFileSync(join(repoDir(), "reports", `${reportId}.json`), "utf8")) as Report;
}

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

const behaviors = [
  { behavior: "ホーム上部に日付が表示される", check: "screenshot" },
  { behavior: "時間帯に応じたあいさつが出る", check: "unit_test" },
];

const open = () => openReport({ worksitePath: worksite, title: "あいさつ表示", behaviors });

describe("openReport", () => {
  it("開くと reportId が返り、状態は下書き", () => {
    const result = open();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.state.state).toBe("draft");
    expect(result.state.behaviors.length).toBe(2);
  });

  it("動作一覧が空の報告は作れない(A3)", () => {
    const result = openReport({ worksitePath: worksite, title: "空の報告", behaviors: [] });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("動作一覧が空");
  });

  it("語彙にない確かめ方は拒否され、fix に語彙一覧が入る", () => {
    const result = openReport({
      worksitePath: worksite,
      title: "語彙テスト",
      behaviors: [{ behavior: "何かが表示される", check: "スクショ" }],
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("語彙にない");
    expect(result.fix).toContain("screenshot");
  });

  it("作業名が空でも動作が空文字でも拒否される", () => {
    expect(openReport({ worksitePath: worksite, title: "  ", behaviors }).status).toBe("rejected");
    expect(
      openReport({ worksitePath: worksite, title: "x", behaviors: [{ behavior: "", check: "screenshot" }] }).status,
    ).toBe("rejected");
  });

  it("同じ作業名+同じ動作一覧の再呼び出しはべき等", () => {
    const first = open();
    const second = open();
    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    expect(second.state.reportId).toBe(first.state.reportId);
    expect(second.state.openedAt).toBe(first.state.openedAt);
    expect(second.note).toContain("既オープン");
  });

  it("同じ作業名で異なる動作一覧は拒否される(動作一覧はオープン時に固定)", () => {
    open();
    const changed = openReport({
      worksitePath: worksite,
      title: "あいさつ表示",
      behaviors: [{ behavior: "別の動作", check: "screenshot" }],
    });
    expect(changed.status).toBe("rejected");
    if (changed.status !== "rejected") throw new Error("expected rejected");
    expect(changed.reason).toContain("固定");
  });
});

describe("attachEvidence — 報告への紐づけ", () => {
  const deps = { installedAppPath: () => app };

  function accepted(reportId: string, behaviorIndex: number, buildId: string) {
    return attachEvidence(
      {
        worksitePath: worksite,
        buildId,
        kind: "screenshot",
        file: screenshot,
        simulatorUdid: "UDID-TEST",
        bundleId: "com.example.sample",
        reportId,
        behaviorIndex,
      },
      deps,
    );
  }

  function setup(): { reportId: string; buildId: string } {
    const report = open();
    const build = registerBuild({ worksitePath: worksite, appPath: app });
    if (report.status !== "ok" || build.status !== "ok") throw new Error("expected ok");
    return { reportId: report.state.reportId, buildId: build.state.buildId };
  }

  it("受理された証拠が動作に紐づき、状態が 下書き → 証拠あり に移る", () => {
    const { reportId, buildId } = setup();
    const result = accepted(reportId, 1, buildId);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.note).toContain("紐づけた");
    const report = readReport(reportId);
    expect(report.state).toBe("evidenced");
    expect(report.evidence.length).toBe(1);
    expect(report.buildIds).toContain(buildId);
  });

  it("未オープンの報告への紐づけは、出所照合より先に拒否される", () => {
    const { buildId } = setup();
    const result = accepted("000000000000", 1, buildId);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("未オープン");
  });

  it("動作の番号が範囲外なら拒否される", () => {
    const { reportId, buildId } = setup();
    const result = accepted(reportId, 3, buildId);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("範囲外");
  });

  it("reportId だけ・behaviorIndex だけの指定は拒否される", () => {
    const { reportId, buildId } = setup();
    const result = attachEvidence(
      {
        worksitePath: worksite,
        buildId,
        kind: "screenshot",
        file: screenshot,
        simulatorUdid: "UDID-TEST",
        bundleId: "com.example.sample",
        reportId,
      },
      deps,
    );
    expect(result.status).toBe("rejected");
  });

  it("同じ紐づけの再呼び出しはべき等(紐づけは増えない)", () => {
    const { reportId, buildId } = setup();
    accepted(reportId, 1, buildId);
    const second = accepted(reportId, 1, buildId);
    if (second.status !== "ok") throw new Error("expected ok");
    expect(second.note).toContain("既に紐づいている");
    expect(readReport(reportId).evidence.length).toBe(1);
  });

  it("報告なしの添付(スライス1 の挙動)は変わらず有効", () => {
    const { buildId } = setup();
    const result = attachEvidence(
      {
        worksitePath: worksite,
        buildId,
        kind: "screenshot",
        file: screenshot,
        simulatorUdid: "UDID-TEST",
        bundleId: "com.example.sample",
      },
      deps,
    );
    expect(result.status).toBe("ok");
  });
});
