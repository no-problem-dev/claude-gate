// いま何を見ているかは URL のクエリに持つ(docs/dashboard-design.md「いま見ている場所は URL に持つ」)。
// React の state に持つと、再読み込みとデーモン再起動で先頭リポジトリに戻り、
// ブラウザの戻るでアプリから出てしまい、特定の報告・ビルド・証拠を人に渡せない。
//
// 既定値は URL に書かない — 既定の解決(先頭リポジトリ・報告があれば完了報告タブ・先頭ビルド)は
// 描画時に記録から導出する。人が選んだものだけが URL に載る。
// ルーティングライブラリは入れない: pushState と popstate だけで足りる量しかない。

import { useMemo, useSyncExternalStore } from "react";
import type { ActivityFilter } from "./ActivityTab";

export type Tab = "reports" | "builds" | "evidence" | "activity";
export type View = "state" | "guide";

export interface Route {
  view: View;
  repo: string | null;
  tab: Tab | null; // null = 記録から既定を導出する
  build: string | null;
  report: string | null;
  evidence: string | null;
  events: ActivityFilter;
}

const TABS: Tab[] = ["reports", "builds", "evidence", "activity"];
const EVENT_FILTERS: ActivityFilter[] = ["milestones", "rejected", "all"];

// 自分で履歴を書き換えたことを購読側へ知らせる合図。
// popstate はブラウザの戻る/進むでしか飛ばないので、pushState だけでは再描画が起きない
const ROUTE_CHANGED = "gate:route";

// 知らない値の URL は既定として扱う(壊れたリンクで画面を壊さない)
function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseRoute(search: string): Route {
  const query = new URLSearchParams(search);
  return {
    view: query.get("view") === "guide" ? "guide" : "state",
    repo: query.get("repo"),
    tab: pick(query.get("tab"), TABS),
    build: query.get("build"),
    report: query.get("report"),
    evidence: query.get("evidence"),
    events: pick(query.get("events"), EVENT_FILTERS) ?? "milestones",
  };
}

export function routeToSearch(route: Route): string {
  const query = new URLSearchParams();
  if (route.view === "guide") query.set("view", "guide");
  if (route.repo !== null) query.set("repo", route.repo);
  if (route.tab !== null) query.set("tab", route.tab);
  if (route.build !== null) query.set("build", route.build);
  if (route.report !== null) query.set("report", route.report);
  if (route.evidence !== null) query.set("evidence", route.evidence);
  if (route.events !== "milestones") query.set("events", route.events);
  const text = query.toString();
  return text === "" ? "" : `?${text}`;
}

// 履歴の積み方: 人の操作は push(戻るで1つずつ戻れる)、起動時の既定解決は replace(履歴を汚さない)
export function navigate(patch: Partial<Route>, options: { replace?: boolean } = {}): void {
  const next = { ...parseRoute(window.location.search), ...patch };
  const search = routeToSearch(next);
  if (search === window.location.search) return;
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  if (options.replace === true) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(ROUTE_CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(ROUTE_CHANGED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(ROUTE_CHANGED, onChange);
  };
}

// URL はアプリの外(ブラウザ)が持つ状態なので、useState ではなく外部ストアとして読む
const currentSearch = () => window.location.search;

export function useRoute(): Route {
  const search = useSyncExternalStore(subscribe, currentSearch, currentSearch);
  return useMemo(() => parseRoute(search), [search]);
}
