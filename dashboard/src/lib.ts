// サーバー(src/kernel/api.ts)の読み取りモデルと 1:1 の型。表示専用

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

export interface RepoDetail {
  repoKey: string;
  name: string;
  commonDir: string;
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

export const KIND_LABEL: Record<Evidence["kind"], string> = {
  screenshot: "スクリーンショット",
  ui_snapshot: "UI スナップショット",
  video: "録画",
};
