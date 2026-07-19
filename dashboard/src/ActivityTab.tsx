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
    return <p className="muted pad">記録はまだありません</p>;
  }

  return (
    <ol className="event-feed">
      {detail.events.map((event, i) => {
        const buildExists = event.buildId !== undefined && detail.builds.some((b) => b.buildId === event.buildId);
        return (
          <li key={`${event.ts}-${i}`} className={event.result === "rejected" ? "event-row rejected" : "event-row"}>
            {event.result === "ok" ? <AcceptBadge /> : <RejectBadge />}
            <span className="event-body">
              {eventSentence(event)}
              {event.reason && <span className="event-reason"> — {event.reason}</span>}
            </span>
            {buildExists && (
              <button className="build-link nowrap" onClick={() => onOpenBuild(event.buildId!)}>
                <BuildDot buildId={event.buildId!} size={8} />
                <span className="mono">{event.buildId!.slice(0, 6)}</span>
              </button>
            )}
            <Time iso={event.ts} />
          </li>
        );
      })}
    </ol>
  );
}
