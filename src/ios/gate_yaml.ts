import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { DEFAULT_PASSLINE, BUNDLED_CANNOT_SEE } from "./defaults.js";
import { CHANGE_KINDS, CHECK_KINDS } from "./words.js";
import type { CannotSeeEntry, Passline } from "./words.js";

// リポジトリ内 gate.yaml: 宣言の置き場(状態 ~/.claude-gate と分離し、git 管理に載せる)。
// 全セクション任意。無ければゲート同梱のデフォルトだけで動く。
// passline の上書きが git のコミットに載ること自体が「下限の例外は人間だけ・記録に残る」の実装

// run_check が実行できる確かめ方。スクショ系は attach_evidence(シミュレータ観測)の領分
export const RUNNABLE_CHECKS = ["compile", "unit_test", "ui_test"] as const;
export type RunnableCheck = (typeof RUNNABLE_CHECKS)[number];

const schema = z
  .object({
    env: z.array(z.string()).default([]),
    worksite: z.array(z.string()).default([]),
    checks: z.record(z.enum(RUNNABLE_CHECKS), z.string()).default({}),
    passline: z.record(z.enum(CHANGE_KINDS), z.array(z.enum(CHECK_KINDS))).default({}),
    cannot_see: z
      .array(
        z.object({
          checks: z.array(z.enum(CHECK_KINDS)),
          keywords: z.array(z.string()),
          reason: z.string(),
          instead: z.string(),
        }),
      )
      .default([]),
  })
  .strict();

export interface GateYaml {
  env: string[];
  worksite: string[];
  checks: Partial<Record<RunnableCheck, string>>;
  passlineOverride: Partial<Passline>;
  cannotSeeExtra: CannotSeeEntry[];
}

export type GateYamlResult = { config: GateYaml | null; error?: undefined } | { config?: undefined; error: string };

const EMPTY: GateYaml = { env: [], worksite: [], checks: {}, passlineOverride: {}, cannotSeeExtra: [] };

// worksitePath から gate.yaml を読む。無ければ null(デフォルトで動く)、壊れていれば error(隠さない)
export function loadGateYaml(worksitePath: string): GateYamlResult {
  const path = join(worksitePath, "gate.yaml");
  if (!existsSync(path)) return { config: null };

  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { error: `gate.yaml が YAML として読めない: ${String(error)}` };
  }
  if (raw === null || raw === undefined) return { config: { ...EMPTY } };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(トップレベル)"}: ${i.message}`).join(" / ");
    return { error: `gate.yaml が語彙に合わない: ${issues}` };
  }
  return {
    config: {
      env: parsed.data.env,
      worksite: parsed.data.worksite,
      checks: parsed.data.checks,
      passlineOverride: parsed.data.passline,
      cannotSeeExtra: parsed.data.cannot_see,
    },
  };
}

// 実効の合格ライン: 同梱デフォルトに gate.yaml の上書き(書いた種類だけ)を重ねる
export function effectivePassline(config: GateYaml | null): Passline {
  return { ...DEFAULT_PASSLINE, ...(config?.passlineOverride ?? {}) };
}

// 実効の見えないこと台帳: 同梱デフォルト + gate.yaml の追記
export function effectiveCannotSee(config: GateYaml | null): CannotSeeEntry[] {
  return [...BUNDLED_CANNOT_SEE, ...(config?.cannotSeeExtra ?? [])];
}
