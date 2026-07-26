import { Card, Chip } from "@heroui/react";
import { useMemo, useRef } from "react";
import { Build, Evidence, RepoDetail, buildTitle, eventSentence, formatTime } from "./lib";
import {
  AcceptBadge,
  BUILD_DOT_EXPLANATION,
  BuildDot,
  DIRTY_EXPLANATION,
  DirtyChip,
  EvidenceThumb,
  Fact,
  Hint,
  RejectBadge,
  SectionTitle,
  Time,
} from "./components";

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
      if (item.buildId === undefined) continue; // 確かめの記録(check_run)はビルドではなくソースに属す
      const list = map.get(item.buildId) ?? [];
      list.push(item);
      map.set(item.buildId, list);
    }
    return map;
  }, [detail.evidence]);

  const selected = detail.builds.find((b) => b.buildId === selectedBuildId) ?? null;
  // 1カラム(1024px 未満)では詳細が一覧の下に来るので、一覧へ戻る導線を詳細に置く
  const listRef = useRef<HTMLDivElement | null>(null);

  if (detail.builds.length === 0) {
    return <p className="p-6 text-zinc-500 dark:text-zinc-400">登録されたビルドはまだありません</p>;
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
      <div ref={listRef} className="scroll-mt-4">
      <Card className="overflow-hidden p-0">
        <ol aria-label="ビルド一覧">
          {detail.builds.map((build, i) => {
            const evidenceCount = evidenceByBuild.get(build.buildId)?.length ?? 0;
            return (
              <li key={build.buildId} className={i > 0 ? "border-t border-black/8 dark:border-white/8" : ""}>
                <button
                  className={`flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-black/4 dark:hover:bg-white/5 ${
                    build.buildId === selectedBuildId
                      ? "bg-black/5 shadow-[inset_3px_0_0] shadow-blue-500 dark:bg-white/8"
                      : ""
                  }`}
                  onClick={() => onSelectBuild(build.buildId)}
                >
                  <BuildDot buildId={build.buildId} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{buildTitle(build)}</span>
                      {build.dirty && <DirtyChip />}
                    </div>
                    <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {build.gitSha ? build.gitSha.slice(0, 7) : "コミットなし"} · {build.buildId.slice(0, 6)}
                    </div>
                  </div>
                  <Chip color={evidenceCount > 0 ? "success" : "default"} size="sm">
                    証拠 {evidenceCount}
                  </Chip>
                </button>
              </li>
            );
          })}
        </ol>
      </Card>
      </div>

      {selected !== null && (
        <BuildDetail
          build={selected}
          evidence={evidenceByBuild.get(selected.buildId) ?? []}
          detail={detail}
          onOpenEvidence={onOpenEvidence}
          onBackToList={() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
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
  onBackToList,
}: {
  build: Build;
  evidence: Evidence[];
  detail: RepoDetail;
  onOpenEvidence: (evidenceId: string) => void;
  onBackToList: () => void;
}) {
  const ownEvents = detail.events.filter((e) => e.buildId === build.buildId);

  return (
    <Card className="min-w-0 p-5" aria-label="ビルドの詳細">
      <button
        className="mb-2 w-fit cursor-pointer text-xs text-zinc-600 underline-offset-2 hover:underline lg:hidden dark:text-zinc-300"
        onClick={onBackToList}
      >
        ↑ ビルド一覧へ戻る
      </button>
      <header className="flex flex-wrap items-center gap-2.5">
        <Hint text={BUILD_DOT_EXPLANATION}>
          <BuildDot buildId={build.buildId} size={12} />
        </Hint>
        <h3 className="text-base font-semibold">{buildTitle(build)}</h3>
        {build.dirty && (
          <Hint text={DIRTY_EXPLANATION}>
            <DirtyChip />
          </Hint>
        )}
      </header>

      <dl className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
        <Fact label="コミット">
          <span className="font-mono">{build.gitSha ? build.gitSha.slice(0, 10) : "なし"}</span>
          {build.dirty && <span className="text-zinc-500 dark:text-zinc-400">(+未コミットの変更あり)</span>}
        </Fact>
        <Fact label="登録">{formatTime(build.registeredAt)}</Fact>
        <Fact label="ビルドID">
          <Hint text={`完全なビルドID: ${build.buildIdFull}`}>
            <span className="font-mono">{build.buildId}</span>
          </Hint>
        </Fact>
      </dl>

      <SectionTitle>証拠</SectionTitle>
      {evidence.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">このビルドで受理された証拠はまだありません</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {evidence.map((item) => (
            <EvidenceThumb key={item.evidenceId} item={item} repoKey={detail.repoKey} onOpen={onOpenEvidence} />
          ))}
        </div>
      )}

      {ownEvents.length > 0 && (
        <>
          <SectionTitle>このビルドのできごと</SectionTitle>
          <ol>
            {ownEvents.map((event, i) => (
              <li key={`${event.ts}-${i}`} className="flex items-baseline gap-2 py-1 text-[13px] text-zinc-600 dark:text-zinc-300">
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
  );
}

