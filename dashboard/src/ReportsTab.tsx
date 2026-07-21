import { Card, Chip } from "@heroui/react";
import { useEffect, useMemo, useRef } from "react";
import {
  CHANGE_KIND_LABEL,
  CHECK_LABEL,
  Evidence,
  REPORT_STATE_COLOR,
  REPORT_STATE_LABEL,
  Report,
  RepoDetail,
  buildTitle,
  formatTime,
} from "./lib";
import { EvidenceThumb, SectionTitle } from "./BuildsTab";
import { AcceptBadge, BuildDot, RejectBadge, Time } from "./components";
import { eventSentence } from "./lib";

// 完了報告タブ: この仕組みの主役オブジェクト。
// カバレッジ表 = 動作ごとに「変更の種類 / 確かめ方 / 証拠 / 判定」(K-1 の人間向け表示)。
// 判定の reason(不合格の理由・確認できずの代替手段)は人間向けの出口なので動作の行に出す

export function ReportsTab({
  detail,
  focusReportId,
  onOpenEvidence,
  onOpenBuild,
}: {
  detail: RepoDetail;
  focusReportId: string | null;
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
          focused={report.reportId === focusReportId}
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
  focused,
  onOpenEvidence,
  onOpenBuild,
}: {
  report: Report;
  detail: RepoDetail;
  focused: boolean;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
}) {
  // できごとから飛んできたときは該当カードへスクロールして強調(できごとはオブジェクトに従属する記録)
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused]);
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
  const ownEvents = detail.events.filter((e) => e.reportId === report.reportId).slice(0, 6);

  return (
    <div ref={cardRef} className="scroll-mt-4">
    <Card className={`p-5 ${focused ? "ring-2 ring-blue-500/60" : ""}`}>
      <header className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-base font-semibold">{report.title}</h3>
        <Chip color={REPORT_STATE_COLOR[report.state]} size="sm">
          {REPORT_STATE_LABEL[report.state]}
        </Chip>
        {report.judgment !== undefined && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400" title="判定した時刻">
            判定 {formatTime(report.judgment.judgedAt)}
          </span>
        )}
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

      {report.submission !== undefined && (
        <p className="mt-3 rounded-xl border border-green-600/30 bg-green-600/8 p-3 text-[13px]">
          {report.submission.prNumber !== undefined ? (
            <>
              <a href={report.submission.prUrl} target="_blank" rel="noreferrer" className="underline">
                PR #{report.submission.prNumber}
              </a>
              (先頭 <span className="font-mono">{report.submission.sha.slice(0, 7)}</span>)をレビュー可能にした(
              {formatTime(report.submission.readiedAt ?? "")})。検証したソース = HEAD = PR
              先頭であることをゲートが照合した上での提出。取り込みは人間の操作。
            </>
          ) : (
            <>
              {report.submission.remote}/{report.submission.branch} へ{" "}
              <span className="font-mono">{report.submission.sha.slice(0, 7)}</span> を push 済み(
              {formatTime(report.submission.pushedAt ?? "")})。旧形式(提出 = push)の記録。
            </>
          )}
        </p>
      )}

      {report.judgment !== undefined && report.judgment.reasons.length > 0 && (
        <ul className="mt-3 grid gap-1 rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-[13px]">
          {report.judgment.reasons.map((reason, i) => (
            <li key={i}>⚠ {reason}</li>
          ))}
        </ul>
      )}

      <SectionTitle>カバレッジ — 動作 × 証拠 × 判定</SectionTitle>
      <ol className="grid gap-2">
        {report.behaviors.map((entry, i) => {
          const index = i + 1;
          const evidence = evidenceByBehavior.get(index) ?? [];
          const verdict = report.judgment?.behaviors.find((b) => b.index === index);
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
                {entry.change_kind !== undefined && (
                  <Chip color="default" size="sm" title="変更の種類">
                    {CHANGE_KIND_LABEL[entry.change_kind] ?? entry.change_kind}
                  </Chip>
                )}
                <Chip color="default" size="sm" title="宣言した確かめ方">
                  {CHECK_LABEL[entry.check] ?? entry.check}
                </Chip>
                {verdict !== undefined ? (
                  <Chip
                    color={verdict.verdict === "ok" ? "success" : verdict.verdict === "ng" ? "danger" : "warning"}
                    size="sm"
                  >
                    {verdict.verdict === "ok" ? "✓ OK" : verdict.verdict === "ng" ? "✕ NG" : "? 確認できず"}
                  </Chip>
                ) : evidence.length > 0 ? (
                  <Chip color="success" size="sm">
                    ✓ 証拠 {evidence.length}
                  </Chip>
                ) : (
                  <Chip color="warning" size="sm">
                    ⚠ 証拠なし
                  </Chip>
                )}
              </div>
              {verdict?.reason !== undefined && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">{verdict.reason}</p>
              )}
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

      {ownEvents.length > 0 && (
        <>
          <SectionTitle>この報告のできごと(直近{ownEvents.length}件 — 全量はできごとタブ)</SectionTitle>
          <ol>
            {ownEvents.map((event, i) => (
              <li
                key={`${event.ts}-${i}`}
                className="flex items-baseline gap-2 py-1 text-[13px] text-zinc-600 dark:text-zinc-300"
              >
                {event.result === "ok" ? <AcceptBadge /> : <RejectBadge />}
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {eventSentence(event)}
                  {event.reason && ` — ${event.reason}`}
                </span>
                <Time iso={event.ts} />
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
    </div>
  );
}
