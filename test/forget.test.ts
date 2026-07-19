import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetBuild, forgetEvidence, forgetRepo, forgetReport, resolveRepoKey } from "../src/kernel/forget.js";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { openReport } from "../src/ios/tools/open_report.js";
import { registerBuild } from "../src/ios/tools/register_build.js";

// 掃除(人間の CLI): 参照されている記録は消せない・レコード単位の削除は監査に残る・べき等

let worksite: string;
let app: string;
let screenshot: string;

function repoKeyOf(): string {
  return resolveRepoKey(worksite) as string;
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

function populate(): { repoKey: string; buildId: string; evidenceId: string; reportId: string } {
  const report = openReport({
    worksitePath: worksite,
    title: "掃除テスト",
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
  return {
    repoKey: repoKeyOf(),
    buildId: build.state.buildId,
    evidenceId: evidence.state.evidenceId,
    reportId: report.state.reportId,
  };
}

describe("resolveRepoKey", () => {
  it("パスは台帳の照合で解決し、未登録パスは登録の副作用なしで null", () => {
    const { repoKey } = populate();
    expect(resolveRepoKey(worksite)).toBe(repoKey);
    expect(resolveRepoKey(repoKey)).toBe(repoKey);
    const stranger = mkdtempSync(join(tmpdir(), "gate-stranger-"));
    execFileSync("git", ["-C", stranger, "init", "-q"]);
    expect(resolveRepoKey(stranger)).toBeNull();
    const registry = JSON.parse(readFileSync(join(process.env.GATE_HOME as string, "repos.json"), "utf8"));
    expect(Object.keys(registry).length).toBe(1); // forget 経路で新規登録されない
  });
});

describe("forget", () => {
  it("参照されているビルド・証拠は消せない(記録の整合を壊す削除を作れない)", () => {
    const { repoKey, buildId, evidenceId } = populate();
    expect(forgetBuild(repoKey, buildId).status).toBe("refused");
    expect(forgetEvidence(repoKey, evidenceId).status).toBe("refused");
  });

  it("報告 → 証拠 → ビルドの順なら消せて、削除が監査ログに残る", () => {
    const { repoKey, buildId, evidenceId, reportId } = populate();
    expect(forgetReport(repoKey, reportId).status).toBe("removed");
    expect(forgetEvidence(repoKey, evidenceId).status).toBe("removed");
    expect(forgetBuild(repoKey, buildId).status).toBe("removed");
    const events = readFileSync(join(process.env.GATE_HOME as string, "repos", repoKey, "events.jsonl"), "utf8");
    expect(events.match(/"tool":"forget"/g)?.length).toBe(3);
  });

  it("証拠の削除は不変コピーも消す", () => {
    const { repoKey, evidenceId, reportId } = populate();
    const stored = join(process.env.GATE_HOME as string, "repos", repoKey, "evidence", `${evidenceId}.png`);
    expect(existsSync(stored)).toBe(true);
    forgetReport(repoKey, reportId);
    forgetEvidence(repoKey, evidenceId);
    expect(existsSync(stored)).toBe(false);
  });

  it("リポジトリまるごとの削除は台帳からも消え、べき等", () => {
    const { repoKey } = populate();
    expect(forgetRepo(repoKey).status).toBe("removed");
    expect(existsSync(join(process.env.GATE_HOME as string, "repos", repoKey))).toBe(false);
    const registry = JSON.parse(readFileSync(join(process.env.GATE_HOME as string, "repos.json"), "utf8"));
    expect(repoKey in registry).toBe(false);
    expect(forgetRepo(repoKey).status).toBe("already-gone");
    expect(forgetBuild(repoKey, "000000000000").status).toBe("already-gone");
  });
});
