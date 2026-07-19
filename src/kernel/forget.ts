import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { appendEvent } from "./audit.js";
import { gateHome, readJson, writeJson } from "./store.js";
import type { Evidence, Report } from "../ios/words.js";

// 掃除(人間の CLI 操作)。エージェントの語彙(MCP ツール)には入れない —
// 「記録を消す」を渡すと失敗を見えなくする操作(A4)になるため。
// レコード単位の削除は events.jsonl に残る(こっそり消せない)。参照されている記録は消せない。

export type ForgetOutcome =
  | { status: "removed"; detail: string }
  | { status: "already-gone"; detail: string }
  | { status: "refused"; detail: string };

interface Registry {
  [repoKey: string]: { commonDir: string; lastSeenAt: string };
}

// repoKey(12桁hex)またはパスを repoKey に解決する。
// パスは registry の commonDir 照合のみ(登録の副作用を起こさない)
export function resolveRepoKey(arg: string): string | null {
  if (/^[0-9a-f]{12}$/.test(arg)) return arg;
  const registry = readJson<Registry>(join(gateHome(), "repos.json")) ?? {};
  if (!existsSync(arg)) return null;
  let commonDir: string;
  try {
    const common = execFileSync("git", ["-C", arg, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    commonDir = realpathSync(resolve(arg, common));
  } catch {
    return null;
  }
  const hit = Object.entries(registry).find(([, entry]) => entry.commonDir === commonDir);
  return hit?.[0] ?? null;
}

export function forgetRepo(repoKey: string): ForgetOutcome {
  const dir = join(gateHome(), "repos", repoKey);
  const registryPath = join(gateHome(), "repos.json");
  const registry = readJson<Registry>(registryPath) ?? {};
  const known = repoKey in registry || existsSync(dir);
  if (!known) return { status: "already-gone", detail: `リポジトリ ${repoKey} の状態は無い` };
  rmSync(dir, { recursive: true, force: true });
  if (repoKey in registry) {
    delete registry[repoKey];
    writeJson(registryPath, registry);
  }
  return { status: "removed", detail: `リポジトリ ${repoKey} の状態をまるごと削除(台帳からも)` };
}

export function forgetBuild(repoKey: string, buildId: string): ForgetOutcome {
  const dir = join(gateHome(), "repos", repoKey);
  const recordPath = join(dir, "builds", `${buildId}.json`);
  if (!existsSync(recordPath)) return { status: "already-gone", detail: `ビルド ${buildId} の記録は無い` };
  const referencedBy = records<Evidence>(join(dir, "evidence")).filter((e) => e.buildId === buildId);
  if (referencedBy.length > 0) {
    return {
      status: "refused",
      detail: `ビルド ${buildId} は証拠 ${referencedBy.map((e) => e.evidenceId).join(", ")} から参照されている(先に証拠を消すか、消さない)`,
    };
  }
  unlinkSync(recordPath);
  appendEvent(dir, { tool: "forget", result: "ok", buildId });
  return { status: "removed", detail: `ビルド ${buildId} を削除(監査ログに記録)` };
}

export function forgetReport(repoKey: string, reportId: string): ForgetOutcome {
  const dir = join(gateHome(), "repos", repoKey);
  const recordPath = join(dir, "reports", `${reportId}.json`);
  const report = readJson<Report>(recordPath);
  if (report === null) return { status: "already-gone", detail: `報告 ${reportId} の記録は無い` };
  unlinkSync(recordPath);
  appendEvent(dir, { tool: "forget", result: "ok", reportId, title: report.title });
  return { status: "removed", detail: `報告 ${reportId}「${report.title}」を削除(監査ログに記録)` };
}

export function forgetEvidence(repoKey: string, evidenceId: string): ForgetOutcome {
  const dir = join(gateHome(), "repos", repoKey);
  const recordPath = join(dir, "evidence", `${evidenceId}.json`);
  const record = readJson<Evidence>(recordPath);
  if (record === null) return { status: "already-gone", detail: `証拠 ${evidenceId} の記録は無い` };
  const referencedBy = records<Report>(join(dir, "reports")).filter((r) =>
    r.evidence.some((e) => e.evidenceId === evidenceId),
  );
  if (referencedBy.length > 0) {
    return {
      status: "refused",
      detail: `証拠 ${evidenceId} は報告 ${referencedBy.map((r) => `「${r.title}」`).join(", ")} から参照されている(先に報告を消すか、消さない)`,
    };
  }
  unlinkSync(recordPath);
  if (record.storedFile !== undefined && existsSync(record.storedFile)) unlinkSync(record.storedFile);
  appendEvent(dir, { tool: "forget", result: "ok", evidenceId });
  return { status: "removed", detail: `証拠 ${evidenceId} を削除(不変コピーも。監査ログに記録)` };
}

function records<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<T>(join(dir, f)))
    .filter((r): r is T => r !== null);
}
