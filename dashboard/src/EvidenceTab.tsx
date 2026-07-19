import { KIND_LABEL, RepoDetail, buildTitle } from "./lib";
import { AcceptBadge, BuildDot, Time } from "./components";

// 証拠タブ: ビルド横断のギャラリー。証拠の顔はスクショ実物と note(何が写っているか)

export function EvidenceTab({
  detail,
  onOpenEvidence,
  onOpenBuild,
}: {
  detail: RepoDetail;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
}) {
  if (detail.evidence.length === 0) {
    return <p className="muted pad">受理された証拠はまだありません</p>;
  }

  return (
    <div className="gallery">
      {detail.evidence.map((item) => {
        const build = detail.builds.find((b) => b.buildId === item.buildId) ?? null;
        const fileUrl = `/api/evidence/${detail.repoKey}/${item.evidenceId}/file`;
        return (
          <figure key={item.evidenceId} className="gallery-card">
            <button className="gallery-media" onClick={() => onOpenEvidence(item.evidenceId)}>
              {item.kind === "screenshot" ? (
                <img src={fileUrl} alt={item.note ?? "スクリーンショット証拠"} loading="lazy" />
              ) : (
                <span className="evidence-file-icon" aria-hidden>
                  {item.kind === "video" ? "🎞" : "🧩"}
                </span>
              )}
            </button>
            <figcaption>
              <div className="gallery-head">
                <AcceptBadge />
                <span className="chip">{KIND_LABEL[item.kind]}</span>
                <span className="right">
                  <Time iso={item.attachedAt} />
                </span>
              </div>
              {item.note && <p className="evidence-note">{item.note}</p>}
              {build !== null && (
                <button className="build-link" onClick={() => onOpenBuild(item.buildId)}>
                  <BuildDot buildId={item.buildId} size={8} />
                  {buildTitle(build)}
                </button>
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
