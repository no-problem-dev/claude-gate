import { Card } from "@heroui/react";
import { RepoDetail, eventSentence } from "./lib";
import { AcceptBadge, BuildDot, RejectBadge, Time } from "./components";

// できごとタブ: 監査ログを日本語の文で。拒否は理由まで一目で

export function ActivityTab({
  detail,
  onOpenBuild,
}: {
  detail: RepoDetail;
  onOpenBuild: (buildId: string) => void;
}) {
  if (detail.events.length === 0) {
    return <p className="p-6 text-zinc-500 dark:text-zinc-400">記録はまだありません</p>;
  }

  return (
    <Card className="overflow-hidden p-0">
      <ol>
        {detail.events.map((event, i) => {
          const buildExists =
            event.buildId !== undefined && detail.builds.some((b) => b.buildId === event.buildId);
          return (
            <li
              key={`${event.ts}-${i}`}
              className={`flex items-baseline gap-2.5 px-3.5 py-2.5 text-[13px] ${
                i > 0 ? "border-t border-black/8 dark:border-white/8" : ""
              } ${event.result === "rejected" ? "bg-red-500/8 dark:bg-red-500/12" : ""}`}
            >
              {event.result === "ok" ? <AcceptBadge /> : <RejectBadge />}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {eventSentence(event)}
                {event.reason && <span className="text-zinc-600 dark:text-zinc-300"> — {event.reason}</span>}
              </span>
              {buildExists && (
                <button
                  className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-zinc-600 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400"
                  onClick={() => onOpenBuild(event.buildId!)}
                >
                  <BuildDot buildId={event.buildId!} size={8} />
                  <span className="font-mono text-xs">{event.buildId!.slice(0, 6)}</span>
                </button>
              )}
              <Time iso={event.ts} className="ml-auto" />
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
