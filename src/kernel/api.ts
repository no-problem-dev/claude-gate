import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { checkRunHeadline } from "../ios/log_summary.js";
import { reportGroup } from "../ios/words.js";
import { unresolvedRejections } from "./attention.js";
import { gateHome, readJson } from "./store.js";
import type { Build, Evidence, Report } from "../ios/words.js";

// 読み取りモデルの証拠は派生フィールドを足す:
// - headline(check_run のみ): ログ末尾のサマリ一行。一覧で「何が起きたか」を追加取得なしで見せる
// - usedBy: 帰属の逆引き(どの報告のどの動作を覆う証拠か)。参照は報告→証拠の片方向だが、
//   人間は証拠から文脈(何のための観測か)を復元したい
export type EvidenceView = Evidence & {
  headline?: string;
  usedBy?: { reportId: string; reportTitle: string; behaviorIndex: number }[];
};

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
  reportId?: string;
  reportState?: string; // 原因のできごとが運ぶ結果(報告の状態)。独立した report_state 行は書かない
  judgmentInvalidated?: boolean;
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
  unresolvedRejected: number; // 未解決の拒否の件数(累積ではない。解消済みの拒否は監査ログの過去記録)
  awaitingHuman: number; // 人間確認待ちの報告の件数
  lastEvent: GateEvent | null;
}

export interface RepoDetail {
  repoKey: string;
  name: string;
  commonDir: string;
  reports: Report[];
  builds: Build[];
  evidence: EvidenceView[];
  events: GateEvent[];
  unresolvedRejections: GateEvent[]; // 新しい順(events と同じ向き)
}

// テキストファイルの末尾 maxBytes だけ読む(テストログは大きくなり得る。サマリ行は末尾にある)
function readTail(path: string, maxBytes = 64 * 1024): string {
  const size = statSync(path).size;
  if (size <= maxBytes) return readFileSync(path, "utf8");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// check_run 証拠に headline(ログ末尾のサマリ一行)を付ける。他の種類はそのまま
function withHeadline(evidence: Evidence): EvidenceView {
  if (evidence.kind !== "check_run" || !existsSync(evidence.storedFile)) return evidence;
  return { ...evidence, headline: checkRunHeadline(readTail(evidence.storedFile), evidence.exitCode ?? 0) };
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
    const reports = readRecords<Report>(join(repoDir, "reports"));
    return {
      repoKey,
      name: repoName(entry.commonDir),
      commonDir: entry.commonDir,
      lastSeenAt: entry.lastSeenAt,
      reports: reports.length,
      builds: readRecords<Build>(join(repoDir, "builds")).length,
      evidence: readRecords<Evidence>(join(repoDir, "evidence")).length,
      unresolvedRejected: unresolvedRejections(events, new Map(reports.map((r) => [r.reportId, r.state]))).length,
      awaitingHuman: reports.filter((r) => reportGroup(r.state) === "awaiting_human").length,
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
  const usedBy = new Map<string, { reportId: string; reportTitle: string; behaviorIndex: number }[]>();
  for (const report of reports) {
    for (const link of report.evidence) {
      const list = usedBy.get(link.evidenceId) ?? [];
      list.push({ reportId: report.reportId, reportTitle: report.title, behaviorIndex: link.behaviorIndex });
      usedBy.set(link.evidenceId, list);
    }
  }
  const evidence = readRecords<Evidence>(join(repoDir, "evidence")).map(
    (record): EvidenceView => ({ ...withHeadline(record), usedBy: usedBy.get(record.evidenceId) }),
  );
  const events = readEvents(repoDir, 200); // 時系列昇順(未解決の導出はこの向きで行う)
  const unresolved = unresolvedRejections(events, new Map(reports.map((r) => [r.reportId, r.state])));
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
    events: events.slice().reverse(),
    unresolvedRejections: unresolved.slice().reverse(),
  };
}

// 証拠ファイル(不変コピー)の場所。repoKey/evidenceId から解決し、ディレクトリ外は指せない
export function evidenceFilePath(repoKey: string, evidenceId: string): string | null {
  if (!/^[0-9a-f]{12}$/.test(repoKey) || !/^[0-9a-f]{12}$/.test(evidenceId)) return null;
  const record = readJson<Evidence>(join(gateHome(), "repos", repoKey, "evidence", `${evidenceId}.json`));
  if (!record || !existsSync(record.storedFile)) return null;
  return record.storedFile;
}
