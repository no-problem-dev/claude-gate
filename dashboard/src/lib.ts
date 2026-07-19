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
  alreadyRegistered?: boolean;
  alreadyAttached?: boolean;
  alreadyOpened?: boolean;
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
  scheme?: string;
  configuration?: string;
  registeredAt: string;
}

export interface Evidence {
  evidenceId: string;
  buildId: string;
  kind: "screenshot" | "ui_snapshot" | "video";
  sourceFile: string;
  storedFile: string;
  simulatorUdid: string;
  bundleId: string;
  note?: string;
  attachedAt: string;
}

export type ReportState = "draft" | "evidenced";

export interface BehaviorEntry {
  behavior: string;
  check: string;
}

export interface Report {
  reportId: string;
  title: string;
  behaviors: BehaviorEntry[];
  state: ReportState;
  evidence: { evidenceId: string; behaviorIndex: number }[];
  buildIds: string[];
  openedAt: string;
}

export const REPORT_STATE_LABEL: Record<ReportState, string> = {
  draft: "下書き",
  evidenced: "証拠あり",
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
};

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
  if (event.tool === "report_state") {
    return `報告が「${event.state === "evidenced" ? "証拠あり" : event.state}」になった`;
  }
  return event.tool;
}
