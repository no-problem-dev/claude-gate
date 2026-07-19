import { useMemo } from "react";
import { Build, Evidence, RepoDetail, buildTitle, eventSentence, formatTime } from "./lib";
import { AcceptBadge, BuildDot, DirtyChip, RejectBadge, Time } from "./components";

// ビルドタブ: マスター(一覧) ⇄ 詳細。ビルドは「何の・いつのビルドか」で名乗る(ID は二次表現)

export function BuildsTab({
  detail,
  selectedBuildId,
  onSelectBuild,
  onOpenEvidence,
}: {
  detail: RepoDetail;
  selectedBuildId: string | null;
  onSelectBuild: (buildId: string) => void;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const evidenceByBuild = useMemo(() => {
    const map = new Map<string, Evidence[]>();
    for (const item of detail.evidence) {
      const list = map.get(item.buildId) ?? [];
      list.push(item);
      map.set(item.buildId, list);
    }
    return map;
  }, [detail.evidence]);

  const selected = detail.builds.find((b) => b.buildId === selectedBuildId) ?? null;

  if (detail.builds.length === 0) {
    return <p className="muted pad">登録されたビルドはまだありません</p>;
  }

  return (
    <div className="master-detail">
      <ol className="build-master" aria-label="ビルド一覧">
        {detail.builds.map((build) => {
          const evidenceCount = evidenceByBuild.get(build.buildId)?.length ?? 0;
          return (
            <li key={build.buildId}>
              <button
                className={build.buildId === selectedBuildId ? "build-row selected" : "build-row"}
                onClick={() => onSelectBuild(build.buildId)}
              >
                <BuildDot buildId={build.buildId} />
                <div className="build-row-body">
                  <div className="build-row-head">
                    <span className="build-row-title">{buildTitle(build)}</span>
                    {build.dirty && <DirtyChip />}
                  </div>
                  <div className="muted small mono">
                    {build.gitSha ? build.gitSha.slice(0, 7) : "コミットなし"} · {build.buildId.slice(0, 6)}
                  </div>
                </div>
                <span className={evidenceCount > 0 ? "count-badge" : "count-badge zero"}>
                  証拠 {evidenceCount}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {selected !== null && (
        <BuildDetail
          build={selected}
          evidence={evidenceByBuild.get(selected.buildId) ?? []}
          detail={detail}
          onOpenEvidence={onOpenEvidence}
        />
      )}
    </div>
  );
}

function BuildDetail({
  build,
  evidence,
  detail,
  onOpenEvidence,
}: {
  build: Build;
  evidence: Evidence[];
  detail: RepoDetail;
  onOpenEvidence: (evidenceId: string) => void;
}) {
  const ownEvents = detail.events.filter((e) => e.buildId === build.buildId);

  return (
    <article className="build-detail" aria-label="ビルドの詳細">
      <header className="build-detail-head">
        <BuildDot buildId={build.buildId} size={12} />
        <h3>{buildTitle(build)}</h3>
        {build.dirty && <DirtyChip />}
      </header>

      <dl className="facts">
        <div>
          <dt>コミット</dt>
          <dd className="mono">
            {build.gitSha ? build.gitSha.slice(0, 10) : "なし"}
            {build.dirty && <span className="muted">(+未コミットの変更)</span>}
          </dd>
        </div>
        <div>
          <dt>登録</dt>
          <dd>{formatTime(build.registeredAt)}</dd>
        </div>
        <div>
          <dt>ビルドID</dt>
          <dd className="mono" title={build.buildIdFull}>
            {build.buildId}
          </dd>
        </div>
      </dl>

      <h4 className="section-title">証拠</h4>
      {evidence.length === 0 ? (
        <p className="muted small">このビルドで受理された証拠はまだありません</p>
      ) : (
        <div className="evidence-grid">
          {evidence.map((item) => (
            <EvidenceThumb key={item.evidenceId} item={item} repoKey={detail.repoKey} onOpen={onOpenEvidence} />
          ))}
        </div>
      )}

      {ownEvents.length > 0 && (
        <>
          <h4 className="section-title">このビルドのできごと</h4>
          <ol className="mini-feed">
            {ownEvents.map((event, i) => (
              <li key={`${event.ts}-${i}`} className="mini-feed-row">
                {event.result === "ok" ? <AcceptBadge /> : <RejectBadge />}
                <span className="event-body">
                  {eventSentence(event)}
                  {event.reason && ` — ${event.reason}`}
                </span>
                <Time iso={event.ts} />
              </li>
            ))}
          </ol>
        </>
      )}
    </article>
  );
}

export function EvidenceThumb({
  item,
  repoKey,
  onOpen,
}: {
  item: Evidence;
  repoKey: string;
  onOpen: (evidenceId: string) => void;
}) {
  const fileUrl = `/api/evidence/${repoKey}/${item.evidenceId}/file`;
  return (
    <button className="evidence-thumb" onClick={() => onOpen(item.evidenceId)}>
      {item.kind === "screenshot" ? (
        <img src={fileUrl} alt={item.note ?? "スクリーンショット証拠"} loading="lazy" />
      ) : (
        <span className="evidence-file-icon" aria-hidden>
          {item.kind === "video" ? "🎞" : "🧩"}
        </span>
      )}
      <span className="evidence-thumb-note">{item.note ?? "(note なし)"}</span>
    </button>
  );
}
