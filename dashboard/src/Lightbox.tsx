import { useEffect } from "react";
import { Build, Evidence, KIND_LABEL, buildTitle, formatTimeFull } from "./lib";
import { AcceptBadge, BuildDot } from "./components";

// 証拠のシングルビュー: 原寸スクショ + 全メタデータ + 属すビルドへのリンク

export function Lightbox({
  evidence,
  build,
  repoKey,
  onClose,
  onOpenBuild,
}: {
  evidence: Evidence;
  build: Build | null;
  repoKey: string;
  onClose: () => void;
  onOpenBuild: (buildId: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fileUrl = `/api/evidence/${repoKey}/${evidence.evidenceId}/file`;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="証拠の詳細" onClick={onClose}>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
        <div className="lightbox-media">
          {evidence.kind === "screenshot" ? (
            <img src={fileUrl} alt={evidence.note ?? "スクリーンショット証拠"} />
          ) : (
            <a className="evidence-file-icon large" href={fileUrl} target="_blank" rel="noreferrer">
              {evidence.kind === "video" ? "🎞 ファイルを開く" : "🧩 ファイルを開く"}
            </a>
          )}
        </div>
        <aside className="lightbox-meta">
          <div className="gallery-head">
            <AcceptBadge />
            <span className="chip">{KIND_LABEL[evidence.kind]}</span>
          </div>
          {evidence.note && <p className="evidence-note">{evidence.note}</p>}

          {build !== null && (
            <button className="build-link" onClick={() => onOpenBuild(evidence.buildId)}>
              <BuildDot buildId={evidence.buildId} size={8} />
              {buildTitle(build)}
            </button>
          )}

          <dl className="facts stacked">
            <div>
              <dt>受理</dt>
              <dd>{formatTimeFull(evidence.attachedAt)}</dd>
            </div>
            <div>
              <dt>アプリ</dt>
              <dd className="mono">{evidence.bundleId}</dd>
            </div>
            <div>
              <dt>シミュレータ</dt>
              <dd className="mono small">{evidence.simulatorUdid}</dd>
            </div>
            <div>
              <dt>証拠ID</dt>
              <dd className="mono">{evidence.evidenceId}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
