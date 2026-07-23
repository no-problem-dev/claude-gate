import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { branchTip, commitsBetween, gitBranch, gitSha, isAncestor, originDefaultBranch, resolveSha } from "../ios/git.js";
import { checkRunHeadline } from "../ios/log_summary.js";
import { reportGroup } from "../ios/words.js";
import { unresolvedRejections } from "./attention.js";
import { gateHome, readJson, repoKeyOf } from "./store.js";
import type { Build, Evidence, Report } from "../ios/words.js";

// 読み取りモデルの証拠は派生フィールドを足す:
// - headline(check_run のみ): ログ末尾のサマリ一行。一覧で「何が起きたか」を追加取得なしで見せる
// - usedBy: 帰属の逆引き(どの報告のどの動作を覆う証拠か)。参照は報告→証拠の片方向だが、
//   人間は証拠から文脈(何のための観測か)を復元したい
export type EvidenceView = Evidence & {
  headline?: string;
  usedBy?: { reportId: string; reportTitle: string; behaviorIndex: number }[];
};

// ずれ: 検証したソースの後に、報告の作業ブランチへ積まれたコミット。
// 人間の動きは非同期(検証は過去・確認はさっき・提出はいま)なので、状態ではなく導出として
// 毎回計算し、発生した瞬間からカードに出す — 提出の門で初めて発覚させない
export interface SourceDrift {
  branch: string;
  tip: string; // ブランチ先端
  ancestorOk: boolean; // false = rebase/巻き戻し(差分確認の対象外)
  commits: { sha: string; subject: string }[];
}

// 取り込みの状態(導出): 提出済みの報告について、受け入れた sha が origin のデフォルトブランチに
// 入ったか。保存しない — origin のいまの状態は毎回問い合わせる。
// 正直な限界: origin の参照はこのマシンが最後に取得した時点の姿
export interface AdoptionStatus {
  defaultBranch: string;
  entered: boolean; // true = デフォルトブランチに入った / false = 取り込み待ち(人間の番)
}

export type ReportView = Report & { drift?: SourceDrift; adoption?: AdoptionStatus };

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
  via?: string; // 人間確認の入口(cli 省略 / dashboard)。監査で経路を見返すための記録
  fromSha?: string; // 差分確認(confirm_delta)のみ
  toSha?: string; // 差分確認(confirm_delta)のみ
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
  reports: ReportView[];
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

// repoKey → 作業場パス(台帳の commonDir から復元)。
// ダッシュボード発の人間確認が、CLI と同じ confirmBehavior(worksitePath 引数)に合流するための解決
export function worksitePathOf(repoKey: string): string | null {
  const entry = readRegistry()[repoKey];
  if (entry === undefined) return null;
  const dir = basename(entry.commonDir) === ".git" ? dirname(entry.commonDir) : entry.commonDir;
  return existsSync(dir) ? dir : null;
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

// ずれの導出: 判定済みで未終着の報告について、検証したソースと作業ブランチ先端を比較する
function deriveDrift(worksite: string | null, report: Report): SourceDrift | undefined {
  if (worksite === null || report.branch === undefined || report.state === "submitted") return undefined;
  const sourceSha = report.judgment?.sourceSha ?? null;
  if (sourceSha === null) return undefined;
  const tip = branchTip(worksite, report.branch);
  if (tip === null || tip === sourceSha) return undefined;
  const ancestorOk = isAncestor(worksite, sourceSha, tip);
  return {
    branch: report.branch,
    tip,
    ancestorOk,
    commits: ancestorOk ? commitsBetween(worksite, sourceSha, tip) : [],
  };
}

// 取り込みの導出: 提出済みの報告の受け入れ sha が origin のデフォルトブランチの祖先か
function deriveAdoption(worksite: string | null, report: Report): AdoptionStatus | undefined {
  if (worksite === null || report.state !== "submitted") return undefined;
  const sha = report.submission?.sha;
  if (sha === undefined) return undefined;
  const defaultBranch = originDefaultBranch(worksite);
  if (defaultBranch === null) return undefined;
  const tip = resolveSha(worksite, `refs/remotes/origin/${defaultBranch}`);
  if (tip === null) return undefined;
  return { defaultBranch, entered: sha === tip || isAncestor(worksite, sha, tip) };
}

// 提出済みの照会(消費者向け): このリポジトリのこの sha に一致する提出済みの報告。
// hook がレビュー可能化の前に呼ぶ。副作用なし(未知のリポジトリは「無い」と答えるだけ)
export function submittedRecord(
  path: string,
  sha: string,
): { submitted: boolean; reportId?: string; title?: string } {
  const repoKey = repoKeyOf(path);
  if (repoKey === null) return { submitted: false };
  const reports = readRecords<Report>(join(gateHome(), "repos", repoKey, "reports"));
  const hit = reports.find((r) => r.state === "submitted" && r.submission?.sha === sha);
  return hit === undefined ? { submitted: false } : { submitted: true, reportId: hit.reportId, title: hit.title };
}

// 提出の記録の正規化: 旧記録(提出が push やドラフト解除を実行していた頃)の時刻・余分なフィールドを
// 現行の形に写す。保存された記録は不変のまま、読み取りモデルだけが最新の語彙で見せる
function normalizeSubmission(report: Report): Report {
  if (report.submission === undefined) return report;
  const s = report.submission;
  return {
    ...report,
    submission: {
      sha: s.sha,
      ...(s.branch !== undefined && { branch: s.branch }),
      recordedAt: s.recordedAt ?? s.readiedAt ?? s.pushedAt,
      ...(s.via !== undefined && { via: s.via }),
    },
  };
}

export function repoDetail(repoKey: string): RepoDetail | null {
  const entry = readRegistry()[repoKey];
  if (!entry) return null;
  const worksite = worksitePathOf(repoKey);
  const repoDir = join(gateHome(), "repos", repoKey);
  const reports: ReportView[] = readRecords<Report>(join(repoDir, "reports")).map((raw) => {
    const report = normalizeSubmission(raw);
    const drift = deriveDrift(worksite, report);
    const adoption = deriveAdoption(worksite, report);
    return {
      ...report,
      ...(drift !== undefined && { drift }),
      ...(adoption !== undefined && { adoption }),
    };
  });
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

// 差分確認の判断材料: 検証したソースと作業場の HEAD のずれ(コミット一覧)。
// 何を引き受けるのかを見せずに引き受けさせない — ダッシュボードはこれを表示してから記録する
export type DeltaPreview =
  | {
      fromSha: string;
      toSha: string;
      branch: string | null;
      ancestorOk: boolean; // false = rebase/巻き戻し(差分確認の対象外)
      commits: { sha: string; subject: string }[];
    }
  | { error: string };

export function deltaPreview(repoKey: string, reportId: string): DeltaPreview {
  if (!/^[0-9a-f]{12}$/.test(repoKey) || !/^[0-9a-f]{12}$/.test(reportId)) return { error: "不正な ID" };
  const worksite = worksitePathOf(repoKey);
  if (worksite === null) return { error: "リポジトリの実体が見つからない(台帳に無いか、ディレクトリが消えている)" };
  const report = readJson<Report>(join(gateHome(), "repos", repoKey, "reports", `${reportId}.json`));
  if (report === null) return { error: "報告が見つからない" };
  const fromSha = report.judgment?.sourceSha ?? null;
  if (fromSha === null) return { error: "検証したソースが確定していない(未判定・dirty 検証・旧形式)" };
  // 引き受け先は報告の作業ブランチ先端(ローカルのチェックアウト状態に依存しない)。
  // 旧報告(ブランチ記録なし)は作業場の HEAD にフォールバック
  const toSha = report.branch !== undefined ? branchTip(worksite, report.branch) : gitSha(worksite);
  if (toSha === null) {
    return {
      error:
        report.branch !== undefined
          ? `作業ブランチ「${report.branch}」が見つからない(削除・改名されていないか確認してください)`
          : "作業場の HEAD が解決できない",
    };
  }
  const ancestorOk = fromSha === toSha || isAncestor(worksite, fromSha, toSha);
  return {
    fromSha,
    toSha,
    branch: report.branch ?? gitBranch(worksite),
    ancestorOk,
    commits: ancestorOk ? commitsBetween(worksite, fromSha, toSha) : [],
  };
}

// 証拠ファイル(不変コピー)の場所。repoKey/evidenceId から解決し、ディレクトリ外は指せない
export function evidenceFilePath(repoKey: string, evidenceId: string): string | null {
  if (!/^[0-9a-f]{12}$/.test(repoKey) || !/^[0-9a-f]{12}$/.test(evidenceId)) return null;
  const record = readJson<Evidence>(join(gateHome(), "repos", repoKey, "evidence", `${evidenceId}.json`));
  if (!record || !existsSync(record.storedFile)) return null;
  return record.storedFile;
}
