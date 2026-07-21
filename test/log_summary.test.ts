import { describe, expect, it } from "vitest";
import { checkRunHeadline, isErrorLine } from "../src/ios/log_summary.js";

// 実データ(repo 3633164599c6)の構造に合わせたゴールデン。
// 要点: 終了コードで抽出を駆動する(失敗時に先行パッケージの passed 行を拾わない)

describe("checkRunHeadline", () => {
  it("swift-testing 成功: 末尾が Build complete でも Test run with ... passed を拾う", () => {
    const log = [
      "◇ Test example() started.",
      "✔ Test run with 24 tests in 7 suites passed after 0.062 seconds.",
      "Building for debugging...",
      "Build complete! (0.37s)",
    ].join("\n");
    expect(checkRunHeadline(log, 0)).toBe("✔ Test run with 24 tests in 7 suites passed after 0.062 seconds.");
  });

  it("失敗: 先に通ったパッケージの passed 行ではなく、末尾の signal クラッシュ行を拾う", () => {
    const log = [
      "✔ Test run with 30 tests in 9 suites passed after 0.1 seconds.", // 先行パッケージは成功
      "Building for debugging...",
      "Build complete! (0.25s)",
      "error: Process 'swiftpm-testing-helper ... --testing-library swift-testing' exited with unexpected signal code 11",
    ].join("\n");
    const h = checkRunHeadline(log, 1);
    expect(h).toContain("signal code 11");
    expect(h).not.toContain("passed");
  });

  it("xcodebuild 成功: ** BUILD SUCCEEDED ** を拾う", () => {
    expect(checkRunHeadline("...\n** BUILD SUCCEEDED **\n", 0)).toBe("** BUILD SUCCEEDED **");
  });

  it("xcodebuild 失敗: ** BUILD FAILED ** を拾う", () => {
    const log = "SomeFile.swift:10:5: error: cannot find 'foo' in scope\n** BUILD FAILED **\n";
    expect(checkRunHeadline(log, 65)).toBe("** BUILD FAILED **");
  });

  it("XCTest 失敗: Executed N tests, with M failures を拾う", () => {
    const log = "Test Suite 'All tests' failed\nExecuted 12 tests, with 2 failures (0 unexpected) in 0.3 seconds\n";
    expect(checkRunHeadline(log, 1)).toContain("with 2 failures");
  });

  it("マーカーが無ければ末尾の非空行にフォールバック", () => {
    expect(checkRunHeadline("line one\nline two\n\n", 0)).toBe("line two");
  });

  it("長すぎる見出しは切り詰める", () => {
    const long = "error: " + "x".repeat(400);
    const h = checkRunHeadline(long, 1);
    expect(h.length).toBeLessThanOrEqual(201);
    expect(h.endsWith("…")).toBe(true);
  });

  it("空ログは (出力なし)", () => {
    expect(checkRunHeadline("", 0)).toBe("(出力なし)");
  });
});

describe("isErrorLine", () => {
  it("error: / signal / FAILED / ✘ を失敗行とみなす", () => {
    expect(isErrorLine("SomeFile.swift:1:1: error: bad")).toBe(true);
    expect(isErrorLine("exited with unexpected signal code 11")).toBe(true);
    expect(isErrorLine("** BUILD FAILED **")).toBe(true);
    expect(isErrorLine("✘ Test failed()")).toBe(true);
  });

  it("通常行は失敗行ではない", () => {
    expect(isErrorLine("Build complete! (0.37s)")).toBe(false);
    expect(isErrorLine("✔ Test run with 24 tests passed")).toBe(false);
  });
});
