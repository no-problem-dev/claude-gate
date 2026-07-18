import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { registerBuild } from "../src/ios/tools/register_build.js";

// 事故 A1 の再現: 古いビルドがシミュレータに残った状態で撮ったスクショは、証拠として拒否される

let worksite: string;
let newApp: string;
let oldApp: string;
let screenshot: string;

function repoDir(): string {
  const reposRoot = join(process.env.GATE_HOME as string, "repos");
  const keys = readdirSync(reposRoot);
  if (keys.length !== 1) throw new Error(`expected 1 repo, got ${keys.length}`);
  return join(reposRoot, keys[0]);
}

function makeApp(dir: string, name: string, binary: string): string {
  const app = join(dir, name);
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "Info.plist"), "<plist>sample</plist>");
  writeFileSync(join(app, "Sample"), binary);
  return app;
}

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  execFileSync("git", ["-C", worksite, "init", "-q"]);
  const artifacts = mkdtempSync(join(tmpdir(), "gate-artifacts-"));
  newApp = makeApp(artifacts, "New.app", "new-binary");
  oldApp = makeApp(artifacts, "Old.app", "old-binary");
  screenshot = join(artifacts, "screen.png");
  writeFileSync(screenshot, "png-bytes");
});

const attachArgs = (buildId: string) => ({
  worksitePath: worksite,
  buildId,
  kind: "screenshot" as const,
  file: screenshot,
  simulatorUdid: "UDID-TEST",
  bundleId: "com.example.sample",
});

describe("registerBuild", () => {
  it("登録するとビルドID が返り、再登録は同じレコードに収束する(べき等)", () => {
    const first = registerBuild({ worksitePath: worksite, appPath: newApp });
    const second = registerBuild({ worksitePath: worksite, appPath: newApp });
    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    expect(second.state.buildId).toBe(first.state.buildId);
    expect(second.state.registeredAt).toBe(first.state.registeredAt);
  });

  it(".app 以外は reason と fix つきで拒否される", () => {
    const result = registerBuild({ worksitePath: worksite, appPath: "/no/such/App.app" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.fix.length).toBeGreaterThan(0);
  });
});

describe("attachEvidence — 出所照合", () => {
  it("A1 再現: シミュレータ内が別ビルドなら拒否され、両方の ID が reason に入る", () => {
    const registered = registerBuild({ worksitePath: worksite, appPath: newApp });
    if (registered.status !== "ok") throw new Error("expected ok");

    const result = attachEvidence(attachArgs(registered.state.buildId), {
      installedAppPath: () => oldApp, // シミュレータには古いビルドが残っている
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("別物");
    expect(result.reason).toContain(registered.state.buildId);
  });

  it("シミュレータ内が登録したビルドなら受理され、不変コピーが作られる", () => {
    const registered = registerBuild({ worksitePath: worksite, appPath: newApp });
    if (registered.status !== "ok") throw new Error("expected ok");

    const result = attachEvidence(attachArgs(registered.state.buildId), {
      installedAppPath: () => newApp,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(readFileSync(result.state.storedFile, "utf8")).toBe("png-bytes");
  });

  it("同じ証拠の再添付は何も増やさない(べき等)", () => {
    const registered = registerBuild({ worksitePath: worksite, appPath: newApp });
    if (registered.status !== "ok") throw new Error("expected ok");
    const deps = { installedAppPath: () => newApp };

    attachEvidence(attachArgs(registered.state.buildId), deps);
    attachEvidence(attachArgs(registered.state.buildId), deps);

    const records = readdirSync(join(repoDir(), "evidence")).filter((f) => f.endsWith(".json"));
    expect(records.length).toBe(1);
  });

  it("未登録のビルドへの添付は拒否される", () => {
    const result = attachEvidence(attachArgs("000000000000"), {
      installedAppPath: () => newApp,
    });
    expect(result.status).toBe("rejected");
  });

  it("成功も拒否も全部 events.jsonl に残る(監査)", () => {
    const registered = registerBuild({ worksitePath: worksite, appPath: newApp });
    if (registered.status !== "ok") throw new Error("expected ok");
    attachEvidence(attachArgs(registered.state.buildId), { installedAppPath: () => oldApp });
    attachEvidence(attachArgs(registered.state.buildId), { installedAppPath: () => newApp });

    const lines = readFileSync(join(repoDir(), "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.length).toBe(3); // register ok + attach rejected + attach ok
    expect(lines.some((l) => l.result === "rejected")).toBe(true);
  });
});
