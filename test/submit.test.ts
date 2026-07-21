import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { judge } from "../src/ios/tools/judge.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { registerBuild } from "../src/ios/tools/register_build.js";
import { runCheck } from "../src/ios/tools/run_check.js";
import { submit } from "../src/ios/tools/submit.js";

// 提出の一本化(A7 / K-5): 合格した報告の、検証されたそのソースの下書きPR だけがレビュー可能にできる。
// gh は PATH に注入した偽物(pr.json を状態にする)で再現する — 実 GitHub 非依存

let worksite: string;
let bare: string;
let app: string;
let screenshot: string;
let prFile: string;

const ORIGINAL_PATH = process.env.PATH ?? "";

// 偽 gh: GH_FAKE_PR(pr.json)が無ければ「PR なし」。pr ready は isDraft を false にする
const FAKE_GH = `#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const args = process.argv.slice(2);
const prFile = process.env.GH_FAKE_PR;
if (args[0] === "--version") { console.log("gh fake"); process.exit(0); }
if (args[0] === "pr" && args[1] === "view") {
  if (!prFile || !existsSync(prFile)) { console.error("no pull requests found for branch"); process.exit(1); }
  console.log(readFileSync(prFile, "utf8"));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "ready") {
  if (!prFile || !existsSync(prFile)) { console.error("no pull requests found"); process.exit(1); }
  const pr = JSON.parse(readFileSync(prFile, "utf8"));
  pr.isDraft = false;
  writeFileSync(prFile, JSON.stringify(pr));
  process.exit(0);
}
console.error("fake gh: unsupported: " + args.join(" "));
process.exit(1);
`;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", worksite, ...args], { encoding: "utf8" }).trim();
}

function commitAll(message: string): void {
  git("add", "-A");
  execFileSync("git", ["-C", worksite, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message]);
}

// 下書きPR の状態を偽 gh に置く(headSha 省略時は HEAD = 検証済みソースと一致)
function putPr(overrides: Partial<Record<string, unknown>> = {}): void {
  writeFileSync(
    prFile,
    JSON.stringify({
      number: 12,
      url: "https://github.com/example/repo/pull/12",
      isDraft: true,
      state: "OPEN",
      headRefOid: git("rev-parse", "HEAD"),
      ...overrides,
    }),
  );
}

function readPr(): { isDraft: boolean } {
  return JSON.parse(readFileSync(prFile, "utf8")) as { isDraft: boolean };
}

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  bare = mkdtempSync(join(tmpdir(), "gate-origin-")) + "/origin.git";
  execFileSync("git", ["init", "-q", "--bare", bare]);
  execFileSync("git", ["-C", worksite, "init", "-q"]);
  git("remote", "add", "origin", bare);
  writeFileSync(join(worksite, "gate.yaml"), 'checks:\n  unit_test: "echo all-green"\n');
  commitAll("init");
  const artifacts = mkdtempSync(join(tmpdir(), "gate-artifacts-"));
  app = join(artifacts, "Sample.app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "Info.plist"), "<plist>sample</plist>");
  writeFileSync(join(app, "Sample"), "binary");
  screenshot = join(artifacts, "screen.png");
  writeFileSync(screenshot, "png-bytes");
  const fakeBin = mkdtempSync(join(tmpdir(), "gate-fakebin-"));
  writeFileSync(join(fakeBin, "gh"), FAKE_GH, { mode: 0o755 });
  prFile = join(fakeBin, "pr.json");
  process.env.PATH = `${fakeBin}:${ORIGINAL_PATH}`;
  process.env.GH_FAKE_PR = prFile;
});

// 合格まで通す(スクショ + ゲート実行のテスト)
function passedReport(): string {
  const report = openReport({
    worksitePath: worksite,
    title: "提出テスト",
    behaviors: [
      { behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" },
      { behavior: "計算が正しい", change_kind: "logic", check: "unit_test" },
    ],
  });
  const build = registerBuild({ worksitePath: worksite, appPath: app });
  if (report.status !== "ok" || build.status !== "ok") throw new Error("expected ok");
  attachEvidence(
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
  runCheck({ worksitePath: worksite, check: "unit_test", reportId: report.state.reportId, behaviorIndex: 2 });
  const judged = judge({ worksitePath: worksite, reportId: report.state.reportId });
  if (judged.status !== "ok" || judged.state.state !== "passed") {
    throw new Error(`expected passed: ${JSON.stringify(judged)}`);
  }
  return report.state.reportId;
}

describe("judge — sourceSha(検証したソース)", () => {
  it("合格した報告に単一の sourceSha が記録される", () => {
    const reportId = passedReport();
    const judged = judge({ worksitePath: worksite, reportId });
    if (judged.status !== "ok") throw new Error("expected ok");
    expect(judged.state.judgment?.sourceSha).toBe(git("rev-parse", "HEAD"));
  });
});

describe("submit", () => {
  it("合格した報告の検証済みソースが push され、下書きPR がレビュー可能になり、提出済みになる", () => {
    const reportId = passedReport();
    putPr();
    const result = submit({ worksitePath: worksite, reportId });
    if (result.status !== "ok") throw new Error(`expected ok: ${JSON.stringify(result)}`);
    expect(result.state.state).toBe("submitted");
    expect(result.state.submission?.sha).toBe(git("rev-parse", "HEAD"));
    expect(result.state.submission?.prNumber).toBe(12);
    expect(result.state.submission?.readiedAt).toBeDefined();
    const pushed = execFileSync("git", ["-C", bare, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(pushed).toBe(git("rev-parse", "HEAD")); // bare remote に実際に届いている
    expect(readPr().isDraft).toBe(false); // ドラフトが解除されている
  });

  it("再 submit はべき等(提出し直さず既提出を返す)", () => {
    const reportId = passedReport();
    putPr();
    submit({ worksitePath: worksite, reportId });
    const again = submit({ worksitePath: worksite, reportId });
    if (again.status !== "ok") throw new Error("expected ok");
    expect(again.note).toContain("既提出");
  });

  it("このブランチの PR が無ければ提出できない(fix は下書きPR の作成)", () => {
    const reportId = passedReport();
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("PR が無い");
    expect(result.fix).toContain("--draft");
  });

  it("PR の先頭が検証したソースと違えば提出できない", () => {
    const reportId = passedReport();
    putPr({ headRefOid: "0000000000000000000000000000000000000000" });
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("PR");
    expect(result.reason).toContain("検証したソース");
  });

  it("取り込み済み・閉じられた PR には提出できない", () => {
    const reportId = passedReport();
    putPr({ state: "MERGED" });
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("取り込み済み");
  });

  it("既にレビュー可能な PR は照合だけ通して記録する(べき等)", () => {
    const reportId = passedReport();
    putPr({ isDraft: false });
    const result = submit({ worksitePath: worksite, reportId });
    if (result.status !== "ok") throw new Error(`expected ok: ${JSON.stringify(result)}`);
    expect(result.state.state).toBe("submitted");
    expect(result.note).toContain("既にレビュー可能");
  });

  it("合格していない報告は提出できない", () => {
    const report = openReport({
      worksitePath: worksite,
      title: "証拠なし",
      behaviors: [{ behavior: "日付が表示される", change_kind: "appearance", check: "screenshot" }],
    });
    if (report.status !== "ok") throw new Error("expected ok");
    const result = submit({ worksitePath: worksite, reportId: report.state.reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("合格していない");
  });

  it("検証後にコミットが動いたら提出できない(HEAD ≠ sourceSha)", () => {
    const reportId = passedReport();
    writeFileSync(join(worksite, "after.txt"), "検証後の変更");
    commitAll("after verify");
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("検証したソース");
  });

  it("作業場が dirty なら提出できない", () => {
    const reportId = passedReport();
    writeFileSync(join(worksite, "wip.txt"), "未コミット");
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("未コミット");
  });

  it("提出済みの報告には証拠を足せない(終着)", () => {
    const reportId = passedReport();
    putPr();
    submit({ worksitePath: worksite, reportId });
    const result = runCheck({ worksitePath: worksite, check: "unit_test", reportId, behaviorIndex: 2 });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("提出済み");
  });

  it("remote が無ければ提出できない", () => {
    const reportId = passedReport();
    git("remote", "remove", "origin");
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.fix).toContain("remote");
  });
});
