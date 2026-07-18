import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIdOf } from "../src/ios/build_id.js";

function makeApp(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "gate-test-"));
  const app = join(root, "Sample.app");
  mkdirSync(app);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(app, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return app;
}

const files = {
  "Info.plist": "<plist>sample</plist>",
  "Sample": "binary-content-here",
  "Frameworks/Lib.framework/Lib": "framework-binary",
};

describe("buildIdOf", () => {
  it("同じ中身なら同じ ID(決定論)", () => {
    const app = makeApp(files);
    expect(buildIdOf(app)).toBe(buildIdOf(app));
  });

  it("置き場所が違っても中身が同じなら同じ ID", () => {
    const a = makeApp(files);
    const b = mkdtempSync(join(tmpdir(), "gate-test-copy-"));
    const copied = join(b, "Sample.app");
    cpSync(a, copied, { recursive: true });
    expect(buildIdOf(copied)).toBe(buildIdOf(a));
  });

  it("1バイトでも違えば別の ID", () => {
    const a = makeApp(files);
    const b = makeApp({ ...files, Sample: "binary-content-herE" });
    expect(buildIdOf(b)).not.toBe(buildIdOf(a));
  });

  it("ファイルの追加でも別の ID", () => {
    const a = makeApp(files);
    const b = makeApp({ ...files, "extra.txt": "x" });
    expect(buildIdOf(b)).not.toBe(buildIdOf(a));
  });
});
