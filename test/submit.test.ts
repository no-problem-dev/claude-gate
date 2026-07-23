import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmDelta } from "../src/ios/confirm.js";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { judge } from "../src/ios/tools/judge.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { registerBuild } from "../src/ios/tools/register_build.js";
import { runCheck } from "../src/ios/tools/run_check.js";
import { submit } from "../src/ios/tools/submit.js";

// 提出は記録だけ(抽象と具体の分離): 検証したソースを受け入れたと記録する状態遷移で、
// git push も gh も実行しない。取り込みに向かう操作のガードは消費者(hook)の領分 —
// guard_official.test.ts が照会分岐を固定する。
// ここでのゴールデンは「提出しても git・GitHub が変わらない」: bare リモートの参照が動かず、
// PATH に置いた監視付きの偽 gh が一度も呼ばれない

let worksite: string;
let bare: string;
let app: string;
let screenshot: string;
let ghCalledMarker: string;

const ORIGINAL_PATH = process.env.PATH ?? "";

// 監視付きの偽 gh: 呼ばれたら marker ファイルを書く(提出が gh を実行していない証明に使う)
const WATCH_GH = `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.GH_CALLED_MARKER, process.argv.slice(2).join(" "));
process.exit(1);
`;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", worksite, ...args], { encoding: "utf8" }).trim();
}

function commitAll(message: string): void {
  git("add", "-A");
  execFileSync("git", ["-C", worksite, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message]);
}

// git が変わっていないことの観測: bare リモートに参照が1つも無い(show-ref は参照ゼロのとき exit 1)
function bareRefs(): string {
  try {
    return execFileSync("git", ["-C", bare, "show-ref"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
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
  writeFileSync(join(fakeBin, "gh"), WATCH_GH, { mode: 0o755 });
  ghCalledMarker = join(fakeBin, "gh-called");
  process.env.PATH = `${fakeBin}:${ORIGINAL_PATH}`;
  process.env.GH_CALLED_MARKER = ghCalledMarker;
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

describe("submit — 記録だけの状態遷移", () => {
  it("合格した報告の提出が記録される(受け入れた sha = 検証したソース)", () => {
    const reportId = passedReport();
    const verified = git("rev-parse", "HEAD");
    const result = submit({ worksitePath: worksite, reportId });
    if (result.status !== "ok") throw new Error(`expected ok: ${JSON.stringify(result)}`);
    expect(result.state.state).toBe("submitted");
    expect(result.state.submission?.sha).toBe(verified);
    expect(result.state.submission?.branch).toBe(git("rev-parse", "--abbrev-ref", "HEAD"));
    expect(result.state.submission?.recordedAt).toBeDefined();
  });

  it("ゴールデン: 提出しても git・GitHub が変わらない(push されず、gh も呼ばれない)", () => {
    const reportId = passedReport();
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("ok");
    expect(bareRefs()).toBe(""); // bare リモートに参照が1つも無い = push は起きていない
    expect(existsSync(ghCalledMarker)).toBe(false); // PATH の監視 gh は一度も呼ばれていない
  });

  it("再 submit はべき等(提出し直さず既提出を返す)", () => {
    const reportId = passedReport();
    submit({ worksitePath: worksite, reportId });
    const again = submit({ worksitePath: worksite, reportId });
    if (again.status !== "ok") throw new Error("expected ok");
    expect(again.note).toContain("既提出");
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

  // dirty 検証は judge が「確認できず」にするので、現行の判定では 合格 + sourceSha 無し は生まれない。
  // この拒否は旧形式の判定レコード(sourceSha を持たない)への防御 — レコードを旧形式に偽装して固定する
  it("検証したソースが確定していない報告(旧形式の判定)は提出できない", () => {
    const reportId = passedReport();
    const reposDir = join(process.env.GATE_HOME!, "repos");
    const repoKey = readdirSync(reposDir)[0];
    const recordPath = join(reposDir, repoKey, "reports", `${reportId}.json`);
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as { judgment?: { sourceSha: string | null } };
    if (record.judgment !== undefined) record.judgment.sourceSha = null;
    writeFileSync(recordPath, JSON.stringify(record));
    const result = submit({ worksitePath: worksite, reportId });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("検証したソースが確定していない");
  });

  // ずれ(検証後に積まれたコミット)は提出を止めない: 提出の記録は「検証したソース X を受け入れた」で
  // あり、X は変わらない。origin との一致のガードは取り込みに向かう操作の瞬間に消費者(hook)が行う
  it("検証後にコミットが積まれても、提出は検証したソースの sha で記録される", () => {
    const reportId = passedReport();
    const verified = git("rev-parse", "HEAD");
    writeFileSync(join(worksite, "after.txt"), "検証後の変更");
    commitAll("after verify");
    const result = submit({ worksitePath: worksite, reportId });
    if (result.status !== "ok") throw new Error(`expected ok: ${JSON.stringify(result)}`);
    expect(result.state.submission?.sha).toBe(verified); // 先端ではなく検証したソース
  });

  it("差分確認の後の提出は、引き受け先(ブランチ先端)の sha で記録される", () => {
    const reportId = passedReport();
    writeFileSync(join(worksite, "after.txt"), "x");
    commitAll("検証後のコミット");
    const tip = git("rev-parse", "HEAD");
    const confirmed = confirmDelta({ worksitePath: worksite, report: reportId, note: "積まれた差分を見た" });
    expect(confirmed.status).toBe("ok");
    const result = submit({ worksitePath: worksite, reportId });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.state.submission?.sha).toBe(tip);
  });

  // 人間の動きは非同期: 提出は記録なのでローカルの状態(チェックアウト・未コミット変更)に依存しない
  it("別ブランチで作業中でも、未コミット変更があっても提出できる", () => {
    const reportId = passedReport();
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    const verified = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "other-work");
    writeFileSync(join(worksite, "other.txt"), "別の作業(未コミット)");
    const result = submit({ worksitePath: worksite, reportId });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.state.submission?.branch).toBe(branch);
    expect(result.state.submission?.sha).toBe(verified);
  });

  it("提出済みの報告には証拠を足せない(終着)", () => {
    const reportId = passedReport();
    submit({ worksitePath: worksite, reportId });
    const result = runCheck({ worksitePath: worksite, check: "unit_test", reportId, behaviorIndex: 2 });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("提出済み");
  });

  it("監査のできごとに 受け入れた sha と入口(via)が残る", () => {
    const reportId = passedReport();
    const verified = git("rev-parse", "HEAD");
    submit({ worksitePath: worksite, reportId, via: "dashboard" });
    const reposDir = join(process.env.GATE_HOME!, "repos");
    const repoKey = execFileSync("ls", [reposDir], { encoding: "utf8" }).trim();
    const events = readFileSync(join(reposDir, repoKey, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const submitted = events.find((e) => e.tool === "submit" && e.result === "ok");
    expect(submitted?.sha).toBe(verified);
    expect(submitted?.via).toBe("dashboard");
    expect(submitted?.reportState).toBe("submitted");
  });
});
