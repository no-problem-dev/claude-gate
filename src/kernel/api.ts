import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gateHome, readJson } from "./store.js";
import type { Build, Evidence, Report } from "../ios/words.js";

// ダッシュボードの読み取りモデル。ゲートの状態(~/.claude-gate)を人間向けに集約する。
// 書き込みは一切しない: 状態を変えられるのは MCP ツールだけ。

interface RepoRegistryEntry {
  commonDir: string;
  lastSeenAt: string;
}

export interface GateEvent {
  ts: string;
  tool: string;
  result: "ok" | "rejected";
  reason?: string;
  buildId?: string;
  evidenceId?: string;
  alreadyRegistered?: boolean;
  alreadyAttached?: boolean;
}

export interface RepoSummary {
  repoKey: string;
  name: string;
  commonDir: string;
  lastSeenAt: string;
  reports: number;
  builds: number;
  evidence: number;
  rejected: number;
  lastEvent: GateEvent | null;
}

export interface RepoDetail {
  repoKey: string;
  name: string;
  commonDir: string;
  reports: Report[];
  builds: Build[];
  evidence: Evidence[];
  events: GateEvent[];
}

// commonDir(…/repo/.git)からリポジトリ名を出す
function repoName(commonDir: string): string {
  const dir = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
  return basename(dir);
}

function readRegistry(): Record<string, RepoRegistryEntry> {
  return readJson<Record<string, RepoRegistryEntry>>(join(gateHome(), "repos.json")) ?? {};
}

function readRecords<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<T>(join(dir, f)))
    .filter((r): r is T => r !== null);
}

function readEvents(repoDir: string, limit: number): GateEvent[] {
  const path = join(repoDir, "events.jsonl");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line) as GateEvent);
}

export function overview(): { repos: RepoSummary[] } {
  const registry = readRegistry();
  const repos = Object.entries(registry).map(([repoKey, entry]) => {
    const repoDir = join(gateHome(), "repos", repoKey);
    const events = readEvents(repoDir, 500);
    return {
      repoKey,
      name: repoName(entry.commonDir),
      commonDir: entry.commonDir,
      lastSeenAt: entry.lastSeenAt,
      reports: readRecords<Report>(join(repoDir, "reports")).length,
      builds: readRecords<Build>(join(repoDir, "builds")).length,
      evidence: readRecords<Evidence>(join(repoDir, "evidence")).length,
      rejected: events.filter((e) => e.result === "rejected").length,
      lastEvent: events.at(-1) ?? null,
    };
  });
  repos.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
  return { repos };
}

export function repoDetail(repoKey: string): RepoDetail | null {
  const entry = readRegistry()[repoKey];
  if (!entry) return null;
  const repoDir = join(gateHome(), "repos", repoKey);
  const reports = readRecords<Report>(join(repoDir, "reports"));
  const builds = readRecords<Build>(join(repoDir, "builds"));
  const evidence = readRecords<Evidence>(join(repoDir, "evidence"));
  reports.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  builds.sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : -1));
  evidence.sort((a, b) => (a.attachedAt < b.attachedAt ? 1 : -1));
  return {
    repoKey,
    name: repoName(entry.commonDir),
    commonDir: entry.commonDir,
    reports,
    builds,
    evidence,
    events: readEvents(repoDir, 200).reverse(),
  };
}

// 証拠ファイル(不変コピー)の場所。repoKey/evidenceId から解決し、ディレクトリ外は指せない
export function evidenceFilePath(repoKey: string, evidenceId: string): string | null {
  if (!/^[0-9a-f]{12}$/.test(repoKey) || !/^[0-9a-f]{12}$/.test(evidenceId)) return null;
  const record = readJson<Evidence>(join(gateHome(), "repos", repoKey, "evidence", `${evidenceId}.json`));
  if (!record || !existsSync(record.storedFile)) return null;
  return record.storedFile;
}
