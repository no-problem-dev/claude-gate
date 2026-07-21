import { Card } from "@heroui/react";
import { useMemo } from "react";
import { GateEvent, RepoDetail, dayLabel, eventSentence } from "./lib";
import { AcceptBadge, BuildDot, RejectBadge, ReportLink, Time } from "./components";

// できごとタブ: 監査ログを日本語の文で。日付でセクション分けし、
// 各行に対象オブジェクトのチップ(報告 = 作業名 / ビルド = 色ドット)を付ける。
// 絞り込みは関心で3つだけ。既定は「節目」— 定型の受理の洪水に読む価値のある行が埋もれるから
// (オブジェクト別の絞り込みは各オブジェクトの「そのできごと」の役目)

export type ActivityFilter = "milestones" | "rejected" | "all";

// 「節目」= 報告の一生の節目(開く・判定・提出・人間確認・掃除)+ 全ての拒否
const MILESTONE_TOOLS = new Set(["open_report", "judge", "submit", "confirm", "forget"]);

const FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "milestones", label: "節目" },
  { key: "rejected", label: "拒否だけ" },
  { key: "all", label: "すべて" },
];

export function ActivityTab({
  detail,
  filter,
  onFilterChange,
  onOpenBuild,
  onOpenReport,
}: {
  detail: RepoDetail;
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
  onOpenBuild: (buildId: string) => void;
  onOpenReport: (reportId: string) => void;
}) {
  const sections = useMemo(() => {
    const filtered = detail.events.filter((event) =>
      filter === "all"
        ? true
        : filter === "rejected"
          ? event.result === "rejected"
          : event.result === "rejected" || MILESTONE_TOOLS.has(event.tool),
    );
    const byDay: { label: string; events: GateEvent[] }[] = [];
    for (const event of filtered) {
      const label = dayLabel(event.ts);
      const last = byDay.at(-1);
      if (last !== undefined && last.label === label) last.events.push(event);
      else byDay.push({ label, events: [event] });
    }
    return byDay;
  }, [detail.events, filter]);

  if (detail.events.length === 0) {
    return <p className="p-6 text-zinc-500 dark:text-zinc-400">記録はまだありません</p>;
  }

  return (
    <div>
      <div className="mb-3 flex gap-1.5" role="group" aria-label="できごとの絞り込み">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === key
                ? "border-blue-500/60 bg-blue-500/12 font-semibold text-blue-700 dark:text-blue-300"
                : "border-black/10 text-zinc-600 hover:bg-black/4 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
            }`}
            aria-pressed={filter === key}
            onClick={() => onFilterChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {sections.length === 0 && (
        <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">この絞り込みに当てはまるできごとはありません</p>
      )}

      <div className="grid gap-4">
        {sections.map((section) => (
          <section key={section.label} aria-label={section.label}>
            <h3 className="mb-1.5 px-1 text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
              {section.label}
            </h3>
            <Card className="overflow-hidden p-0">
              <ol>
                {section.events.map((event, i) => (
                  <EventRow
                    key={`${event.ts}-${i}`}
                    event={event}
                    detail={detail}
                    first={i === 0}
                    onOpenBuild={onOpenBuild}
                    onOpenReport={onOpenReport}
                  />
                ))}
              </ol>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}

function EventRow({
  event,
  detail,
  first,
  onOpenBuild,
  onOpenReport,
}: {
  event: GateEvent;
  detail: RepoDetail;
  first: boolean;
  onOpenBuild: (buildId: string) => void;
  onOpenReport: (reportId: string) => void;
}) {
  // 掃除で消えた報告・ビルドのチップは出さない(文だけ残る)
  const report = detail.reports.find((r) => r.reportId === event.reportId);
  const buildExists = event.buildId !== undefined && detail.builds.some((b) => b.buildId === event.buildId);

  return (
    <li
      className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-[13px] ${
        first ? "" : "border-t border-black/8 dark:border-white/8"
      } ${event.result === "rejected" ? "bg-red-500/8 dark:bg-red-500/12" : ""}`}
    >
      {event.result === "ok" ? <AcceptBadge /> : <RejectBadge />}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {eventSentence(event)}
        {event.reason && <span className="text-zinc-600 dark:text-zinc-300"> — {event.reason}</span>}
      </span>
      {report !== undefined && (
        <ReportLink
          label={report.title}
          title={`報告「${report.title}」を開く`}
          onOpen={() => onOpenReport(report.reportId)}
        />
      )}
      {buildExists && (
        <button
          className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-zinc-600 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400"
          title="ビルドを開く"
          onClick={() => onOpenBuild(event.buildId!)}
        >
          <BuildDot buildId={event.buildId!} size={8} />
          <span className="font-mono text-xs">{event.buildId!.slice(0, 6)}</span>
        </button>
      )}
      <Time iso={event.ts} className="ml-auto" />
    </li>
  );
}
