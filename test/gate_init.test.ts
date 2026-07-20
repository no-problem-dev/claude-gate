import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initGateYaml } from "../src/ios/gate_init.js";

describe("initGateYaml", () => {
  it("gate.yaml が無ければ雛形を作る", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-init-"));
    const result = initGateYaml(dir);
    expect(result.status).toBe("created");
    expect(existsSync(join(dir, "gate.yaml"))).toBe(true);
    expect(readFileSync(join(dir, "gate.yaml"), "utf8")).toContain("checks:");
  });

  it("既存の gate.yaml は上書きしない(べき等)", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-init-"));
    writeFileSync(join(dir, "gate.yaml"), "checks:\n  unit_test: mine\n");
    const result = initGateYaml(dir);
    expect(result.status).toBe("exists");
    expect(readFileSync(join(dir, "gate.yaml"), "utf8")).toContain("unit_test: mine");
  });
});
