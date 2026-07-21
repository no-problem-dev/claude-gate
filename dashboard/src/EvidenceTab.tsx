import { Card } from "@heroui/react";
import { EVIDENCE_KIND_LABEL, Evidence, RepoDetail, checkLabel, evidenceCaption, evidenceIcon } from "./lib";
import { AcceptBadge, BuildLink, EvidenceVideo, ExitCodeChip, ReportLink, TaxonomyChip, Time } from "./components";

// 証拠タブ: 帰属(どの報告のどの動作を覆う証拠か)を第一の文脈にする。
// 種類の性質でコレクションを分ける — スクショ・録画は「見る」もの(ギャラリー)、
// 確かめの記録・UIスナップショット・実機レポートは「読む」もの(リスト行)。
// 同じグリッドに混ぜると高さが揃わず、テキストカードが同一の見た目で並んで区別できない(設計 §2)

export function EvidenceTab({
  detail,
  onOpenEvidence,
  onOpenBuild,
  onOpenReport,
}: {
  detail: RepoDetail;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
  onOpenReport: (reportId: string) => void;
}) {
  if (detail.evidence.length === 0) {
    return <p className="p-6 text-zinc-500 dark:text-zinc-400">受理された証拠はまだありません</p>;
  }

  const visual = detail.evidence.filter((e) => e.kind === "screenshot" || e.kind === "video");
  const checkRuns = detail.evidence.filter((e) => e.kind === "check_run");
  const others = detail.evidence.filter((e) => e.kind === "ui_snapshot" || e.kind === "device_report");

  return (
    <div className="grid gap-6">
      {visual.length > 0 && (
        <section>
          <GroupTitle>視覚証拠(スクリーンショット・録画) {visual.length}件</GroupTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
            {visual.map((item) => (
              <VisualCard
                key={item.evidenceId}
                item={item}
                detail={detail}
                onOpenEvidence={onOpenEvidence}
                onOpenBuild={onOpenBuild}
                onOpenReport={onOpenReport}
              />
            ))}
          </div>
        </section>
      )}

      {checkRuns.length > 0 && (
        <section>
          <GroupTitle>確かめの記録 {checkRuns.length}件</GroupTitle>
          <Card className="overflow-hidden p-0">
            <ol>
              {checkRuns.map((item, i) => (
                <li key={item.evidenceId} className={i > 0 ? "border-t border-black/8 dark:border-white/8" : ""}>
                  <div className="grid gap-1.5 px-3.5 py-3">
                    <button
                      className="flex w-full cursor-pointer flex-wrap items-center gap-2 text-left"
                      onClick={() => onOpenEvidence(item.evidenceId)}
                    >
                      <span aria-hidden>🧪</span>
                      <span className="text-[13px] font-semibold">
                        {item.check !== undefined ? checkLabel(item.check) : "確かめ"}
                      </span>
                      <ExitCodeChip exitCode={item.exitCode} />
                      <Time iso={item.attachedAt} className="ml-auto" />
                    </button>
                    {item.command !== undefined && (
                      <code className="clamp-1 font-mono text-[11px] break-all text-zinc-500 dark:text-zinc-400">
                        {item.command}
                      </code>
                    )}
                    {item.headline !== undefined && (
                      <p
                        className={`clamp-1 font-mono text-[11px] break-all ${
                          item.exitCode === 0 ? "text-zinc-600 dark:text-zinc-300" : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {item.headline}
                      </p>
                    )}
                    <UsedByChips item={item} onOpenReport={onOpenReport} />
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <GroupTitle>その他の観測(UIスナップショット・実機レポート) {others.length}件</GroupTitle>
          <Card className="overflow-hidden p-0">
            <ol>
              {others.map((item, i) => {
                const build = detail.builds.find((b) => b.buildId === item.buildId);
                return (
                  <li key={item.evidenceId} className={i > 0 ? "border-t border-black/8 dark:border-white/8" : ""}>
                    <div className="grid gap-1.5 px-3.5 py-3">
                      <button
                        className="flex w-full cursor-pointer flex-wrap items-center gap-2 text-left"
                        onClick={() => onOpenEvidence(item.evidenceId)}
                      >
                        <span aria-hidden>{evidenceIcon(item.kind)}</span>
                        <span className="text-[13px] font-semibold">{EVIDENCE_KIND_LABEL[item.kind]}</span>
                        <span className="min-w-0 text-[13px] text-zinc-600 dark:text-zinc-300">
                          {evidenceCaption(item)}
                        </span>
                        <Time iso={item.attachedAt} className="ml-auto" />
                      </button>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <UsedByChips item={item} onOpenReport={onOpenReport} />
                        {build !== undefined && <BuildLink build={build} onOpen={onOpenBuild} />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </section>
      )}
    </div>
  );
}

function VisualCard({
  item,
  detail,
  onOpenEvidence,
  onOpenBuild,
  onOpenReport,
}: {
  item: Evidence;
  detail: RepoDetail;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
  onOpenReport: (reportId: string) => void;
}) {
  const build = detail.builds.find((b) => b.buildId === item.buildId);
  const fileUrl = `/api/evidence/${detail.repoKey}/${item.evidenceId}/file`;
  return (
    <Card className="overflow-hidden p-0">
      <button className="block w-full cursor-zoom-in p-0" onClick={() => onOpenEvidence(item.evidenceId)}>
        {item.kind === "screenshot" ? (
          <img
            className="h-56 w-full border-b border-black/8 object-cover object-top dark:border-white/8"
            src={fileUrl}
            alt={item.note ?? "スクリーンショット証拠"}
            loading="lazy"
          />
        ) : (
          <EvidenceVideo
            src={fileUrl}
            className="h-56 w-full border-b border-black/8 bg-black object-contain dark:border-white/8"
          />
        )}
      </button>
      <div className="px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <AcceptBadge />
          <TaxonomyChip>{EVIDENCE_KIND_LABEL[item.kind]}</TaxonomyChip>
          <Time iso={item.attachedAt} className="ml-auto" />
        </div>
        <p className="mt-2 mb-1.5 text-[13px]">{evidenceCaption(item)}</p>
        <div className="grid gap-1">
          <UsedByChips item={item} onOpenReport={onOpenReport} />
          {build !== undefined && <BuildLink build={build} onOpen={onOpenBuild} />}
        </div>
      </div>
    </Card>
  );
}

// 帰属チップ: この証拠が覆う報告の作業名 + 動作番号(クリックで該当報告へ)。
// どの報告にも紐づいていない証拠は、その事実を静かに示す(孤児の観測が見える)
function UsedByChips({ item, onOpenReport }: { item: Evidence; onOpenReport: (reportId: string) => void }) {
  if (item.usedBy === undefined || item.usedBy.length === 0) {
    return <span className="text-xs text-zinc-500 dark:text-zinc-400">報告に未紐づけ</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {item.usedBy.map((use) => (
        <ReportLink
          key={`${use.reportId}-${use.behaviorIndex}`}
          label={`${use.reportTitle} · 動作${use.behaviorIndex}`}
          title={`報告「${use.reportTitle}」の動作${use.behaviorIndex}を覆う証拠。クリックで報告へ`}
          onOpen={() => onOpenReport(use.reportId)}
        />
      ))}
    </span>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 px-1 text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
      {children}
    </h3>
  );
}
