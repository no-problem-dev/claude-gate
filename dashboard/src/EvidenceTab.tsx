import { Card } from "@heroui/react";
import { KIND_LABEL, RepoDetail, buildTitle, evidenceCaption, evidenceIcon } from "./lib";
import { AcceptBadge, BuildDot, CheckRunGlance, EvidenceVideo, NeutralChip, Time } from "./components";

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
    return <p className="p-6 text-zinc-500 dark:text-zinc-400">受理された証拠はまだありません</p>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
      {detail.evidence.map((item) => {
        const build = detail.builds.find((b) => b.buildId === item.buildId);
        const fileUrl = `/api/evidence/${detail.repoKey}/${item.evidenceId}/file`;
        return (
          <Card key={item.evidenceId} className="overflow-hidden p-0">
            <button className="block w-full cursor-zoom-in p-0" onClick={() => onOpenEvidence(item.evidenceId)}>
              {item.kind === "screenshot" ? (
                <img
                  className="max-h-64 w-full border-b border-black/8 object-cover object-top dark:border-white/8"
                  src={fileUrl}
                  alt={item.note ?? "スクリーンショット証拠"}
                  loading="lazy"
                />
              ) : item.kind === "video" ? (
                <EvidenceVideo
                  src={fileUrl}
                  className="max-h-64 w-full border-b border-black/8 bg-black object-contain dark:border-white/8"
                />
              ) : item.kind === "check_run" ? (
                <div className="border-b border-black/8 dark:border-white/8">
                  <CheckRunGlance evidence={item} />
                </div>
              ) : (
                <span className="grid aspect-[9/12] place-items-center text-3xl" aria-hidden>
                  {evidenceIcon(item.kind)}
                </span>
              )}
            </button>
            <div className="px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <AcceptBadge />
                <NeutralChip>{KIND_LABEL[item.kind]}</NeutralChip>
                <Time iso={item.attachedAt} className="ml-auto" />
              </div>
              <p className="mt-2 mb-1.5 text-[13px]">{evidenceCaption(item)}</p>
              {build !== undefined && item.buildId !== undefined && (
                <button
                  className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400"
                  onClick={() => onOpenBuild(item.buildId!)}
                >
                  <BuildDot buildId={item.buildId} size={8} />
                  {buildTitle(build)}
                </button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
