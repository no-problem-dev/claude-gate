import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { effectiveCannotSee, effectivePassline, loadGateYaml } from "../src/ios/gate_yaml.js";
import { BUNDLED_CANNOT_SEE, DEFAULT_PASSLINE } from "../src/ios/defaults.js";

// gate.yaml: 宣言の置き場。無くても動き、壊れていたら隠さずエラーになる

let worksite: string;

beforeEach(() => {
  worksite = mkdtempSync(join(tmpdir(), "gate-yaml-"));
});

describe("loadGateYaml", () => {
  it("無ければ null(同梱デフォルトだけで動く)", () => {
    const result = loadGateYaml(worksite);
    expect(result.error).toBeUndefined();
    expect(result.config).toBeNull();
    expect(effectivePassline(null)).toEqual(DEFAULT_PASSLINE);
    expect(effectiveCannotSee(null)).toEqual(BUNDLED_CANNOT_SEE);
  });

  it("全セクションが読める", () => {
    writeFileSync(
      join(worksite, "gate.yaml"),
      [
        "env:",
        '  - "Debug は wrangler dev が必要"',
        "worksite:",
        '  - "xcodegen generate"',
        "checks:",
        '  unit_test: "swift test"',
        "passline:",
        "  logic: [unit_test]",
        "cannot_see:",
        "  - checks: [interaction_log]",
        "    keywords: [位置情報]",
        '    reason: "シミュレータの位置情報は擬似値"',
        '    instead: "human_check"',
      ].join("\n"),
    );
    const result = loadGateYaml(worksite);
    if (result.config === undefined || result.config === null) throw new Error("expected config");
    expect(result.config.env.length).toBe(1);
    expect(result.config.checks.unit_test).toBe("swift test");
    expect(effectivePassline(result.config).logic).toEqual(["unit_test"]);
    expect(effectivePassline(result.config).appearance).toEqual(DEFAULT_PASSLINE.appearance); // 書いてない種類は同梱のまま
    expect(effectiveCannotSee(result.config).length).toBe(BUNDLED_CANNOT_SEE.length + 1);
  });

  it("壊れた YAML・語彙外の値はエラーになる(隠さない)", () => {
    writeFileSync(join(worksite, "gate.yaml"), "checks: [これは map ではない");
    expect(loadGateYaml(worksite).error).toContain("gate.yaml");

    writeFileSync(join(worksite, "gate.yaml"), "passline:\n  logic: [目視]\n");
    expect(loadGateYaml(worksite).error).toContain("語彙に合わない");

    writeFileSync(join(worksite, "gate.yaml"), "unknown_section: 1\n");
    expect(loadGateYaml(worksite).error).toContain("語彙に合わない");
  });
});
