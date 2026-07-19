import { Card, Chip } from "@heroui/react";
import { useMemo } from "react";
import { CHECK_LABEL, Evidence, REPORT_STATE_LABEL, Report, RepoDetail, buildTitle } from "./lib";
import { EvidenceThumb, SectionTitle } from "./BuildsTab";
import { BuildDot, Time } from "./components";

// 完了報告タブ: この仕組みの主役オブジェクト。
// カバレッジ表 = 動作ごとに「確かめ方 / 証拠 / 覆われているか」(K-1 の人間向け表示)

export function ReportsTab({
  detail,
  onOpenEvidence,
  onOpenBuild,
}: {
  detail: RepoDetail;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
}) {
  if (detail.reports.length === 0) {
    return (
      <div className="p-6 text-sm">
        <p>完了報告はまだありません。</p>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          エージェントが作業を始めるときに報告を開く(作業名と動作一覧を宣言する)と、ここに現れます。
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {detail.reports.map((report) => (
        <ReportCard
          key={report.reportId}
          report={report}
          detail={detail}
          onOpenEvidence={onOpenEvidence}
          onOpenBuild={onOpenBuild}
        />
      ))}
    </div>
  );
}

function ReportCard({
  report,
  detail,
  onOpenEvidence,
  onOpenBuild,
}: {
  report: Report;
  detail: RepoDetail;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
}) {
  const evidenceByBehavior = useMemo(() => {
    const map = new Map<number, Evidence[]>();
    for (const link of report.evidence) {
      const item = detail.evidence.find((e) => e.evidenceId === link.evidenceId);
      if (!item) continue;
      const list = map.get(link.behaviorIndex) ?? [];
      list.push(item);
      map.set(link.behaviorIndex, list);
    }
    return map;
  }, [report.evidence, detail.evidence]);

  const covered = report.behaviors.filter((_, i) => (evidenceByBehavior.get(i + 1)?.length ?? 0) > 0).length;

  return (
    <Card className="p-5">
      <header className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-base font-semibold">{report.title}</h3>
        <Chip color={report.state === "evidenced" ? "accent" : "default"} size="sm">
          {REPORT_STATE_LABEL[report.state]}
        </Chip>
        {report.buildIds.length > 1 && (
          <Chip
            color="warning"
            size="sm"
            title="動作ごとに別のビルドの証拠が混ざっている。最新のビルドで全動作が動くことの保証にはならない"
          >
            ⚠ 複数ビルドの証拠が混在
          </Chip>
        )}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          動作 {covered}/{report.behaviors.length} が証拠で覆われている
        </span>
        <span className="ml-auto">
          <Time iso={report.openedAt} />
        </span>
      </header>

      <SectionTitle>カバレッジ — 動作 × 証拠</SectionTitle>
      <ol className="grid gap-2">
        {report.behaviors.map((entry, i) => {
          const index = i + 1;
          const evidence = evidenceByBehavior.get(index) ?? [];
          return (
            <li
              key={index}
              className="rounded-xl border border-black/8 p-3.5 dark:border-white/8"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-black/6 text-xs font-semibold dark:bg-white/10">
                  {index}
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-medium">{entry.behavior}</span>
                <Chip color="default" size="sm">
                  {CHECK_LABEL[entry.check] ?? entry.check}
                </Chip>
                {evidence.length > 0 ? (
                  <Chip color="success" size="sm">
                    ✓ 証拠 {evidence.length}
                  </Chip>
                ) : (
                  <Chip color="warning" size="sm">
                    ⚠ 証拠なし
                  </Chip>
                )}
              </div>
              {evidence.length > 0 && (
                <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
                  {evidence.map((item) => (
                    <EvidenceThumb key={item.evidenceId} item={item} repoKey={detail.repoKey} onOpen={onOpenEvidence} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {report.buildIds.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[11px] tracking-widest text-zinc-500 uppercase dark:text-zinc-400">対象ビルド</span>
          {report.buildIds.map((buildId) => {
            const build = detail.builds.find((b) => b.buildId === buildId);
            return (
              <button
                key={buildId}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400"
                onClick={() => onOpenBuild(buildId)}
              >
                <BuildDot buildId={buildId} size={8} />
                {build ? buildTitle(build) : <span className="font-mono">{buildId.slice(0, 6)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
