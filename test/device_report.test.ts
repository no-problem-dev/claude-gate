import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { attachEvidence } from "../src/ios/tools/attach_evidence.js";
import { registerBuild } from "../src/ios/tools/register_build.js";

// 実機レポート(device_report): 実機から .app を取れないので、
// レポート本文の buildUUID を登録ビルドの Mach-O UUID と照合して受理する

const BUILD_UUID = "1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D";
const OTHER_UUID = "2C8D5F6B-0E3F-4B5C-9D7E-1F2A3B4C5D6E";

let worksite: string;
let app: string;
let reportFile: string;

function makeApp(dir: string, name: string): string {
  const appDir = join(dir, name);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "Info.plist"), "<plist>sample</plist>");
  writeFileSync(join(appDir, name.replace(/\.app$/, "")), "device-binary");
  return appDir;
}

function repoDir(): string {
  const reposRoot = join(process.env.GATE_HOME as string, "repos");
  const keys = readdirSync(reposRoot);
  if (keys.length !== 1) throw new Error(`expected 1 repo, got ${keys.length}`);
  return join(reposRoot, keys[0]);
}

// register_build に UUID を注入する(実バイナリの dwarfdump に依存しない)
const registerWithUuids = (uuids: string[]) =>
  registerBuild({ worksitePath: worksite, appPath: app }, { machoUuidsOf: () => uuids });

const attachArgs = (buildId: string) => ({
  worksitePath: worksite,
  buildId,
  kind: "device_report" as const,
  file: reportFile,
  deviceUdid: "DEVICE-UDID",
  bundleId: "com.example.sample",
});

beforeEach(() => {
  process.env.GATE_HOME = mkdtempSync(join(tmpdir(), "gate-home-"));
  worksite = mkdtempSync(join(tmpdir(), "gate-worksite-"));
  execFileSync("git", ["-C", worksite, "init", "-q"]);
  const artifacts = mkdtempSync(join(tmpdir(), "gate-artifacts-"));
  app = makeApp(artifacts, "Sample.app");
  reportFile = join(artifacts, "console.log");
  writeFileSync(reportFile, `[boot] launched\nbuildUUID=${BUILD_UUID}\n[SPIKE] keychain restored\n`);
});

describe("register_build — Mach-O UUID の記録", () => {
  it("抽出した UUID を machoUuids に記録する", () => {
    const result = registerWithUuids([BUILD_UUID]);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.state.machoUuids).toEqual([BUILD_UUID]);
  });
});

describe("attachEvidence(device_report) — UUID 照合", () => {
  it("レポートの buildUUID が登録ビルドの UUID に一致すれば受理される", () => {
    const registered = registerWithUuids([BUILD_UUID]);
    if (registered.status !== "ok") throw new Error("expected ok");

    const result = attachEvidence(attachArgs(registered.state.buildId));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.state.kind).toBe("device_report");
    expect(result.state.deviceUdid).toBe("DEVICE-UDID");
    expect(result.state.simulatorUdid).toBeUndefined();
    expect(readFileSync(result.state.storedFile, "utf8")).toContain("keychain restored");
  });

  it("別ビルドの UUID なら拒否され、両方の UUID が reason に入る", () => {
    const registered = registerWithUuids([OTHER_UUID]); // 実機で走ったのとは別物
    if (registered.status !== "ok") throw new Error("expected ok");

    const result = attachEvidence(attachArgs(registered.state.buildId));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("別物");
    expect(result.reason).toContain(BUILD_UUID);
    expect(result.reason).toContain(OTHER_UUID);
  });

  it("レポートに buildUUID 行が無いと拒否され、fix に Swift スニペットが入る", () => {
    const registered = registerWithUuids([BUILD_UUID]);
    if (registered.status !== "ok") throw new Error("expected ok");
    writeFileSync(reportFile, "[boot] launched\n[SPIKE] no uuid printed\n");

    const result = attachEvidence(attachArgs(registered.state.buildId));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("buildUUID");
    expect(result.fix).toContain("currentBuildUUID");
  });

  it("登録ビルドに UUID の記録が無いと拒否される(UUID を読めなかった .app)", () => {
    const registered = registerWithUuids([]); // dwarfdump が読めなかった
    if (registered.status !== "ok") throw new Error("expected ok");

    const result = attachEvidence(attachArgs(registered.state.buildId));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("Mach-O UUID の記録が無い");
  });

  it("deviceUdid が無いと拒否される", () => {
    const registered = registerWithUuids([BUILD_UUID]);
    if (registered.status !== "ok") throw new Error("expected ok");

    const { deviceUdid, ...withoutDevice } = attachArgs(registered.state.buildId);
    void deviceUdid;
    const result = attachEvidence(withoutDevice);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toContain("deviceUdid");
  });
});
