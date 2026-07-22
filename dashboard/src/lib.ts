// サーバー(src/kernel/api.ts)の読み取りモデルと 1:1 の型。表示専用。
// 語彙(型とラベル)は src/ios/words.ts を直接 import する — 対訳の写しをここに持たない

import {
  CHANGE_KIND_LABEL,
  CHECK_LABEL,
  DELTA_CONFIRM_LABEL,
  EVIDENCE_KIND_LABEL,
  REPORT_GROUP_LABEL,
  REPORT_STATE_LABEL,
  UNRESOLVED_REJECTION_LABEL,
  VERDICT_LABEL,
  reportGroup,
} from "../../src/ios/words";
import type { EvidenceKind, ReportGroup, ReportState, Verdict } from "../../src/ios/words";

export {
  DELTA_CONFIRM_LABEL,
  EVIDENCE_KIND_LABEL,
  REPORT_GROUP_LABEL,
  REPORT_STATE_LABEL,
  UNRESOLVED_REJECTION_LABEL,
  VERDICT_LABEL,
  reportGroup,
};
export type { EvidenceKind, ReportGroup, ReportState, Verdict };

// 語彙導入前の記録は識別子のまま残っている。ラベル参照は必ずこの2つを通す(識別子へのフォールバックを一元化)
export function checkLabel(check: string): string {
  return (CHECK_LABEL as Record<string, string>)[check] ?? check;
}

export function changeKindLabel(kind: string): string {
  return (CHANGE_KIND_LABEL as Record<string, string>)[kind] ?? kind;
}

export function reportStateLabel(state: string): string {
  return (REPORT_STATE_LABEL as Record<string, string>)[state] ?? state;
}

export interface GateEvent {
  ts: string;
  tool: string;
  result: "ok" | "rejected";
  reason?: string;
  buildId?: string;
  evidenceId?: string;
  reportId?: string;
  behaviorIndex?: number;
  state?: string; // 旧形式の独立した report_state 行のみ(新形式は reportState を原因の行が運ぶ)
  reportState?: string;
  judgmentInvalidated?: boolean;
  via?: string; // 人間確認の入口(cli 省略 / dashboard)
  check?: string;
  exitCode?: number;
  verdict?: string;
  sha?: string;
  branch?: string;
  prNumber?: number;
  fromSha?: string; // 差分確認(confirm_delta)のみ
  toSha?: string; // 差分確認(confirm_delta)のみ
  commits?: number; // 差分確認(confirm_delta)のみ: 引き受けたコミット数
  alreadyRegistered?: boolean;
  alreadyAttached?: boolean;
  alreadyOpened?: boolean;
  alreadySubmitted?: boolean;
  alreadyConfirmed?: boolean;
}

export interface RepoSummary {
  repoKey: string;
  name: string;
  commonDir: string;
  lastSeenAt: string;
  reports: number;
  builds: number;
  evidence: number;
  unresolvedRejected: number; // 未解決の拒否(累積ではない)
  awaitingHuman: number; // 人間確認待ちの報告
  lastEvent: GateEvent | null;
}

export interface Build {
  buildId: string;
  buildIdFull: string;
  appPath: string;
  gitSha: string | null;
  dirty: boolean;
  machoUuids?: string[];
  scheme?: string;
  configuration?: string;
  registeredAt: string;
}

export interface Evidence {
  evidenceId: string;
  kind: EvidenceKind;
  storedFile: string;
  note?: string;
  attachedAt: string;
  // シミュレータ観測・実機レポートのみ
  buildId?: string;
  sourceFile?: string;
  simulatorUdid?: string;
  deviceUdid?: string;
  bundleId?: string;
  // 確かめの記録(check_run)のみ
  check?: string;
  command?: string;
  exitCode?: number;
  gitSha?: string | null;
  dirty?: boolean;
  headline?: string; // サーバーが付ける派生値: ログ末尾のサマリ一行
  usedBy?: { reportId: string; reportTitle: string; behaviorIndex: number }[]; // 帰属の逆引き(どの報告のどの動作を覆うか)
}

export interface BehaviorEntry {
  behavior: string;
  change_kind?: string;
  check: string;
}

export interface BehaviorVerdict {
  index: number;
  verdict: "ok" | "ng" | "unconfirmed";
  reason?: string;
}

export interface Judgment {
  verdict: "passed" | "failed" | "unconfirmed";
  behaviors: BehaviorVerdict[];
  reasons: string[];
  sourceSha?: string | null; // submit が HEAD と照合する有効なソース(差分確認の連鎖を適用した先)
  verifiedSha?: string | null; // 機械が検証したソース(差分確認が無ければ sourceSha と同じ)
  judgedAt: string;
}

// 差分確認: 検証したソースの後に積まれた差分を人間が見て、判定を引き受けた記録(src/ios/words.ts と 1:1)
export interface DeltaConfirmation {
  fromSha: string;
  toSha: string;
  note: string;
  confirmedAt: string;
}

export interface Submission {
  sha: string;
  branch: string;
  remote: string;
  prNumber?: number; // レビュー可能にした PR。旧形式(提出 = push)の記録には無い
  prUrl?: string;
  readiedAt?: string;
  pushedAt?: string; // 旧形式(提出 = push)の記録のみ
}

// ずれ: 検証したソースの後に作業ブランチへ積まれたコミット(サーバーの読み取りモデルの導出。保存されない)
export interface SourceDrift {
  branch: string;
  tip: string;
  ancestorOk: boolean;
  commits: { sha: string; subject: string }[];
}

export interface Report {
  reportId: string;
  title: string;
  branch?: string; // 作業ブランチ(オープン時に記録。旧報告には無い)
  behaviors: BehaviorEntry[];
  state: ReportState;
  evidence: { evidenceId: string; behaviorIndex: number }[];
  buildIds: string[];
  openedAt: string;
  judgment?: Judgment;
  deltaConfirms?: DeltaConfirmation[];
  submission?: Submission;
  drift?: SourceDrift;
}

export const REPORT_STATE_COLOR: Record<ReportState, "default" | "accent" | "success" | "danger" | "warning"> = {
  draft: "default",
  evidenced: "accent",
  passed: "success",
  failed: "danger",
  unconfirmed: "warning",
  submitted: "success",
};

export interface RepoDetail {
  repoKey: string;
  name: string;
  commonDir: string;
  reports: Report[];
  builds: Build[];
  evidence: Evidence[];
  events: GateEvent[];
  unresolvedRejections: GateEvent[]; // 新しい順(events と同じ向き)
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

// 旧形式の記録では、報告の状態の変化が独立した report_state 行として書かれていた
// (二重記録で、因果が逆順になる例もあった)。新形式は原因の行が reportState を運ぶ。
// 旧記録は表示層で隣接する原因行(同じ報告・近接時刻)に畳む — 記録自体は書き換えない
const STATE_CAUSE_TOOLS = new Set(["attach_evidence", "run_check", "judge", "submit"]);

export function foldReportStateEvents(events: GateEvent[]): GateEvent[] {
  const out = events.map((e) => ({ ...e }));
  const drop = new Set<number>();
  for (let i = 0; i < out.length; i++) {
    const event = out[i];
    if (event.tool !== "report_state" || event.reportId === undefined) continue;
    for (const j of [i - 1, i + 1, i - 2, i + 2]) {
      const host = out[j];
      if (host === undefined || drop.has(j)) continue;
      if (host.result !== "ok" || host.reportId !== event.reportId || !STATE_CAUSE_TOOLS.has(host.tool)) continue;
      if (Math.abs(new Date(host.ts).getTime() - new Date(event.ts).getTime()) > 2000) continue;
      if (host.reportState === undefined) host.reportState = event.state;
      drop.add(i);
      break;
    }
  }
  return out.filter((_, i) => !drop.has(i));
}

const RELATIVE = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });

export function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "たった今";
  if (seconds < 3600) return RELATIVE.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return RELATIVE.format(-Math.floor(seconds / 3600), "hour");
  return RELATIVE.format(-Math.floor(seconds / 86400), "day");
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTimeFull(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// できごとの日付セクション見出し: 今日 / 昨日 / M月D日(曜)
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days === 0) return "今日";
  if (days === 1) return "昨日";
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
}

// 24時間以内は相対、それより古いものは絶対。title には常に完全な時刻を持たせる
export function humanTime(iso: string): { text: string; title: string } {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  return {
    text: seconds < 86400 ? timeAgo(iso) : formatTime(iso),
    title: formatTimeFull(iso),
  };
}

export function evidenceIcon(kind: Evidence["kind"]): string {
  if (kind === "video") return "🎞";
  if (kind === "check_run") return "🧪";
  if (kind === "device_report") return "📱";
  if (kind === "human_check") return "👤";
  return "🧩";
}

// 失敗行のハイライト判定(ログ表示用)。サーバーの src/ios/log_summary.ts ERROR_LINE_RE と 1:1
const ERROR_LINE_RE =
  /(\*\* (?:BUILD|TEST|CLEAN|ARCHIVE|ANALYZE|INSTALL) FAILED \*\*|\berror:|✘|unexpected signal code \d+|\bsignal (?:code )?\d+\b|Fatal error|fatalError|Segmentation fault|\bcrashed\b|with [1-9]\d* (?:issue|failure))/;

export function isErrorLogLine(line: string): boolean {
  return ERROR_LINE_RE.test(line);
}

// 証拠の一言表示: シミュレータ観測は note、確かめの記録は何をどう実行した結果か、
// 実機レポートは実機で走ったアプリのセルフレポート
export function evidenceCaption(item: Evidence): string {
  if (item.kind === "check_run") {
    const label = item.check !== undefined ? checkLabel(item.check) : "確かめ";
    const outcome = item.exitCode === 0 ? "終了コード 0" : `終了コード ${item.exitCode}(失敗)`;
    return item.note ?? `${label}をゲートが実行 — ${outcome}`;
  }
  if (item.kind === "device_report") {
    return item.note ?? "実機で走ったアプリのセルフレポート(Mach-O UUID 照合済み)";
  }
  if (item.kind === "human_check") {
    return item.note !== undefined ? `人間が確認した: ${item.note}` : "人間確認の記録";
  }
  return item.note ?? "(note なし)";
}

// ビルドの見出し: ID ではなく「何の・いつのビルドか」で名乗る(docs/dashboard-design.md §4)
export function buildTitle(build: Build): string {
  const what = [build.scheme, build.configuration].filter(Boolean).join(" ") || "ビルド";
  return `${what} — ${formatTime(build.registeredAt)}`;
}

// 色の識別点: ビルドID から決定的に色相を導出。状態色(拒否の赤・警告の琥珀・受理の緑)の色相域を
// 除外した範囲(180°〜330°: シアン〜青〜紫〜マゼンタ)に写像する — 無意味な赤/橙のドットが
// 「不良」に誤読される事故を色空間の設計で消す(補助チャネル。ID 文字列は常に併記)
export function buildHue(buildId: string): number {
  return 180 + (parseInt(buildId.slice(0, 4), 16) % 150);
}

// 原因のできごとが運ぶ結果(報告の状態の変化)を文に付記する。
// 判定・提出は文自体が結果を含むので付けない(証拠の受理・確かめの実行だけ)
function stateSuffix(event: GateEvent): string {
  if (event.reportState === undefined) return "";
  if (event.judgmentInvalidated === true) {
    return ` → 判定は無効になり、報告は「${reportStateLabel(event.reportState)}」に戻った`;
  }
  return ` → 報告は「${reportStateLabel(event.reportState)}」へ`;
}

// できごとを日本語の文にする(ツールの英語名は UI に出さない)
export function eventSentence(event: GateEvent): string {
  const again =
    event.alreadyRegistered || event.alreadyAttached || event.alreadyOpened || event.alreadyConfirmed
      ? "(既存の記録を返却)"
      : "";
  if (event.tool === "register_build") {
    return event.result === "ok" ? `ビルドを登録${again}` : "ビルドの登録を拒否";
  }
  if (event.tool === "attach_evidence") {
    return event.result === "ok" ? `証拠を受理${again}${stateSuffix(event)}` : "証拠を拒否";
  }
  if (event.tool === "open_report") {
    return event.result === "ok" ? `報告を開いた${again}` : "報告を開くのを拒否";
  }
  if (event.tool === "run_check") {
    const check = event.check !== undefined ? checkLabel(event.check) : "確かめ";
    return event.result === "ok"
      ? `${check}を実行(終了コード ${event.exitCode})${again}${stateSuffix(event)}`
      : `${check}の実行を拒否`;
  }
  if (event.tool === "judge") {
    return event.result === "ok" ? `判定した — ${reportStateLabel(event.verdict ?? "")}` : "判定を拒否";
  }
  if (event.tool === "submit") {
    if (event.result !== "ok") return "提出を拒否";
    if (event.alreadySubmitted) return "提出(既提出の返却)";
    return event.prNumber !== undefined
      ? `提出した — PR #${event.prNumber} をレビュー可能にした`
      : `提出した — ${event.branch ?? ""} を push`;
  }
  if (event.tool === "confirm") {
    return event.result === "ok"
      ? `人間が動作${event.behaviorIndex ?? ""}を確認した${again}${stateSuffix(event)}`
      : "人間確認を拒否";
  }
  if (event.tool === "confirm_delta") {
    const range =
      event.fromSha !== undefined && event.toSha !== undefined
        ? `(${event.fromSha.slice(0, 7)} → ${event.toSha.slice(0, 7)})`
        : "";
    return event.result === "ok" ? `人間が差分を確認して引き受けた${range}${again}` : "差分確認を拒否";
  }
  if (event.tool === "forget") {
    return "記録を掃除(人間の操作)";
  }
  if (event.tool === "report_state") {
    return `報告が「${reportStateLabel(event.state ?? "")}」になった`;
  }
  return event.tool;
}
