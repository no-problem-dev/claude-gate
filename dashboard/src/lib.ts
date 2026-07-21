// サーバー(src/kernel/api.ts)の読み取りモデルと 1:1 の型。表示専用

export interface GateEvent {
  ts: string;
  tool: string;
  result: "ok" | "rejected";
  reason?: string;
  buildId?: string;
  evidenceId?: string;
  reportId?: string;
  behaviorIndex?: number;
  state?: string;
  check?: string;
  exitCode?: number;
  verdict?: string;
  sha?: string;
  branch?: string;
  prNumber?: number;
  alreadyRegistered?: boolean;
  alreadyAttached?: boolean;
  alreadyOpened?: boolean;
  alreadySubmitted?: boolean;
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
  kind: "screenshot" | "ui_snapshot" | "video" | "check_run" | "device_report";
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
}

export type ReportState = "draft" | "evidenced" | "passed" | "failed" | "unconfirmed" | "submitted";

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
  sourceSha?: string | null;
  judgedAt: string;
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

export interface Report {
  reportId: string;
  title: string;
  behaviors: BehaviorEntry[];
  state: ReportState;
  evidence: { evidenceId: string; behaviorIndex: number }[];
  buildIds: string[];
  openedAt: string;
  judgment?: Judgment;
  submission?: Submission;
}

export const REPORT_STATE_LABEL: Record<ReportState, string> = {
  draft: "下書き",
  evidenced: "証拠あり",
  passed: "合格",
  failed: "不合格",
  unconfirmed: "確認できず",
  submitted: "提出済み",
};

export const REPORT_STATE_COLOR: Record<ReportState, "default" | "accent" | "success" | "danger" | "warning"> = {
  draft: "default",
  evidenced: "accent",
  passed: "success",
  failed: "danger",
  unconfirmed: "warning",
  submitted: "success",
};

// 確かめ方の語彙(ゲート words.ts と 1:1)。語彙導入前の記録は識別子のまま表示される
export const CHECK_LABEL: Record<string, string> = {
  compile: "コンパイル",
  unit_test: "ユニットテスト",
  screenshot: "スクショ",
  interaction_log: "操作記録",
  ui_test: "UIテスト",
  video: "録画",
  launch_check: "起動確認",
  device_report: "実機レポート",
  human_check: "人間確認",
};

// 変更の種類の語彙(ゲート words.ts と 1:1)
export const CHANGE_KIND_LABEL: Record<string, string> = {
  logic: "ロジック",
  appearance: "見た目",
  interaction: "操作・遷移",
  motion: "動き",
  data: "データ",
  contract: "契約",
  config: "設定",
  system: "連携",
};

export interface RepoDetail {
  repoKey: string;
  name: string;
  commonDir: string;
  reports: Report[];
  builds: Build[];
  evidence: Evidence[];
  events: GateEvent[];
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
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

export const KIND_LABEL: Record<Evidence["kind"], string> = {
  screenshot: "スクリーンショット",
  ui_snapshot: "UI スナップショット",
  video: "録画",
  check_run: "確かめの記録",
  device_report: "実機レポート",
};

export function evidenceIcon(kind: Evidence["kind"]): string {
  return kind === "video" ? "🎞" : kind === "check_run" ? "🧪" : kind === "device_report" ? "📱" : "🧩";
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
    const label = item.check !== undefined ? (CHECK_LABEL[item.check] ?? item.check) : "確かめ";
    const outcome = item.exitCode === 0 ? "終了コード 0" : `終了コード ${item.exitCode}(赤)`;
    return item.note ?? `${label}をゲートが実行 — ${outcome}`;
  }
  if (item.kind === "device_report") {
    return item.note ?? "実機で走ったアプリのセルフレポート(Mach-O UUID 照合済み)";
  }
  return item.note ?? "(note なし)";
}

// ビルドの見出し: ID ではなく「何の・いつのビルドか」で名乗る(docs/dashboard-design.md §4)
export function buildTitle(build: Build): string {
  const what = [build.scheme, build.configuration].filter(Boolean).join(" ") || "ビルド";
  return `${what} — ${formatTime(build.registeredAt)}`;
}

// 色の識別点: ビルドID から決定的に色相を導出(補助チャネル。ID 文字列は常に併記)
export function buildHue(buildId: string): number {
  return parseInt(buildId.slice(0, 4), 16) % 360;
}

// できごとを日本語の文にする(ツールの英語名は UI に出さない)
export function eventSentence(event: GateEvent): string {
  const again = event.alreadyRegistered || event.alreadyAttached || event.alreadyOpened ? "(既存の記録を返却)" : "";
  if (event.tool === "register_build") {
    return event.result === "ok" ? `ビルドを登録${again}` : "ビルドの登録を拒否";
  }
  if (event.tool === "attach_evidence") {
    return event.result === "ok" ? `証拠を受理${again}` : "証拠を拒否";
  }
  if (event.tool === "open_report") {
    return event.result === "ok" ? `報告を開いた${again}` : "報告を開くのを拒否";
  }
  if (event.tool === "run_check") {
    const check = event.check !== undefined ? (CHECK_LABEL[event.check] ?? event.check) : "確かめ";
    return event.result === "ok" ? `${check}を実行(終了コード ${event.exitCode})${again}` : `${check}の実行を拒否`;
  }
  if (event.tool === "judge") {
    const verdict = REPORT_STATE_LABEL[event.verdict as ReportState] ?? event.verdict;
    return event.result === "ok" ? `判定した — ${verdict}` : "判定を拒否";
  }
  if (event.tool === "submit") {
    if (event.result !== "ok") return "提出を拒否";
    if (event.alreadySubmitted) return "提出(既提出の返却)";
    return event.prNumber !== undefined
      ? `提出した — PR #${event.prNumber} をレビュー可能にした`
      : `提出した — ${event.branch ?? ""} を push`;
  }
  if (event.tool === "forget") {
    return "記録を掃除(人間の操作)";
  }
  if (event.tool === "report_state") {
    return `報告が「${REPORT_STATE_LABEL[event.state as ReportState] ?? event.state}」になった`;
  }
  return event.tool;
}
