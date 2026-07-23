import { Chip, Tabs } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  REPORT_GROUP_LABEL,
  RepoDetail,
  RepoSummary,
  AWAITING_ADOPTION_LABEL,
  UNRESOLVED_REJECTION_LABEL,
  eventSentence,
  fetchJson,
  foldReportStateEvents,
  reportGroup,
} from "./lib";
import { ReportLink, Time } from "./components";
import { BuildsTab } from "./BuildsTab";
import { EvidenceTab } from "./EvidenceTab";
import { ActivityFilter, ActivityTab } from "./ActivityTab";
import { GuideView } from "./GuideView";
import { Lightbox } from "./Lightbox";
import { ReportsTab } from "./ReportsTab";

const POLL_MS = 5000;

export type Tab = "reports" | "builds" | "evidence" | "activity";
type View = "state" | "guide";

export function App() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [selectedRepoKey, setSelectedRepoKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [tab, setTab] = useState<Tab>("builds");
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [focusReportId, setFocusReportId] = useState<string | null>(null);
  const [lightboxEvidenceId, setLightboxEvidenceId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("milestones");
  const [daemonOk, setDaemonOk] = useState(true);
  const [view, setView] = useState<View>("state");

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<{ repos: RepoSummary[] }>("/api/overview");
      setRepos(data.repos);
      setDaemonOk(true);
    } catch {
      setDaemonOk(false);
    }
  }, []);

  // 初回だけ先頭リポジトリを選び、報告があれば完了報告タブを開く(主役オブジェクト)
  useEffect(() => {
    if (selectedRepoKey === null && repos !== null && repos.length > 0) {
      setSelectedRepoKey(repos[0].repoKey);
      setTab(repos[0].reports > 0 ? "reports" : "builds");
    }
  }, [repos, selectedRepoKey]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (selectedRepoKey === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchJson<RepoDetail>(`/api/repos/${selectedRepoKey}`);
        // 旧形式の report_state 行は受信時に原因行へ畳む(以後の全ビューが畳んだ形を見る)
        if (!cancelled) setDetail({ ...data, events: foldReportStateEvents(data.events) });
      } catch {
        if (!cancelled) setDetail(null);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedRepoKey]);

  // ビルドの選択状態: リポジトリを切り替えたらリセット、ポーリング更新はまたいで保持
  const effectiveBuildId = useMemo(() => {
    if (detail === null) return null;
    if (selectedBuildId !== null && detail.builds.some((b) => b.buildId === selectedBuildId)) {
      return selectedBuildId;
    }
    return detail.builds[0]?.buildId ?? null;
  }, [detail, selectedBuildId]);

  const selectRepo = (repoKey: string) => {
    setView("state");
    if (repoKey === selectedRepoKey) return;
    setSelectedRepoKey(repoKey);
    setSelectedBuildId(null);
    setFocusReportId(null);
    setLightboxEvidenceId(null);
    setActivityFilter("milestones");
    const summary = repos?.find((r) => r.repoKey === repoKey);
    setTab(summary !== undefined && summary.reports > 0 ? "reports" : "builds");
  };

  // 相互リンク: 証拠・できごとから属すビルドへ
  const openBuild = (buildId: string) => {
    setTab("builds");
    setSelectedBuildId(buildId);
    setLightboxEvidenceId(null);
  };

  // 相互リンク: できごとから報告へ(完了報告タブで該当カードを強調してスクロール)
  const openReport = (reportId: string) => {
    setTab("reports");
    setFocusReportId(reportId);
    setLightboxEvidenceId(null);
  };

  const lightboxEvidence = detail?.evidence.find((e) => e.evidenceId === lightboxEvidenceId) ?? null;
  const hasUnresolvedReject = (detail?.unresolvedRejections.length ?? 0) > 0;

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[272px_1fr]">
      <aside className="flex flex-col border-r border-black/10 bg-white/60 md:sticky md:top-0 md:h-screen md:overflow-y-auto dark:border-white/10 dark:bg-white/3">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <span
            className="grid size-10 place-items-center rounded-xl border border-black/10 text-xl dark:border-white/10"
            aria-hidden
          >
            ⛩
          </span>
          <div>
            <h1 className="text-base font-semibold tracking-tight">Claude Gate</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">証拠つき完了報告</p>
          </div>
        </div>

        <button
          className={`mx-2 mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold transition-colors hover:bg-black/4 dark:hover:bg-white/5 ${
            view === "guide" ? "bg-black/5 dark:bg-white/8" : ""
          }`}
          onClick={() => setView("guide")}
        >
          <span aria-hidden>📖</span> この仕組みのガイド
        </button>

        <h2 className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
          リポジトリ
        </h2>
        {repos === null && <p className="px-4 text-sm text-zinc-500 dark:text-zinc-400">読み込み中…</p>}
        {repos !== null && repos.length === 0 && (
          <div className="px-4 text-sm">
            <p>まだ記録がありません。</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              エージェントがビルドを登録すると、ここに現れます。
            </p>
          </div>
        )}
        {(repos ?? []).map((repo) => (
          <button
            key={repo.repoKey}
            className={`w-full cursor-pointer px-4 py-2.5 text-left transition-colors hover:bg-black/4 dark:hover:bg-white/5 ${
              repo.repoKey === selectedRepoKey
                ? "bg-black/5 shadow-[inset_3px_0_0] shadow-blue-500 dark:bg-white/8"
                : ""
            }`}
            onClick={() => selectRepo(repo.repoKey)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{repo.name}</span>
              <Time iso={repo.lastSeenAt} />
            </div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
              <span>報告 {repo.reports}</span>
              <span>ビルド {repo.builds}</span>
              <span>証拠 {repo.evidence}</span>
              {repo.unresolvedRejected > 0 && (
                <span className="font-semibold text-red-600 dark:text-red-400">
                  {UNRESOLVED_REJECTION_LABEL} {repo.unresolvedRejected}
                </span>
              )}
              {repo.awaitingHuman > 0 && (
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {REPORT_GROUP_LABEL.awaiting_human} {repo.awaitingHuman}
                </span>
              )}
            </div>
          </button>
        ))}

        <div className="mt-auto px-4 pt-4 pb-4">
          <Chip color={daemonOk ? "success" : "danger"} size="sm">
            {daemonOk ? "● デーモン稼働中" : "● デーモン応答なし"}
          </Chip>
        </div>
      </aside>

      <main className="min-w-0 max-w-[1080px] px-5 pt-6 pb-16 md:px-7">
        {view === "guide" ? (
          <GuideView />
        ) : detail === null ? (
          <p className="p-6 text-zinc-500 dark:text-zinc-400">
            {repos?.length === 0 ? "" : "リポジトリを選択してください"}
          </p>
        ) : (
          <>
            <header>
              <h2 className="text-xl font-semibold tracking-tight">{detail.name}</h2>
              <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {detail.commonDir.replace(/\/\.git$/, "")}
              </p>
            </header>

            <AttentionBand
              detail={detail}
              onOpenRejections={() => {
                setTab("activity");
                setActivityFilter("rejected");
              }}
              onOpenReport={openReport}
            />

            <Tabs
              className="mt-4"
              selectedKey={tab}
              onSelectionChange={(key) => setTab(key as Tab)}
            >
              <Tabs.ListContainer className="w-fit">
                <Tabs.List aria-label="オブジェクトの種類">
                  <Tabs.Tab id="reports" className="whitespace-nowrap">
                    完了報告
                    <Chip color="default" size="sm">
                      {detail.reports.length}
                    </Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="builds" className="whitespace-nowrap">
                    ビルド
                    <Chip color="default" size="sm">
                      {detail.builds.length}
                    </Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="evidence" className="whitespace-nowrap">
                    証拠
                    <Chip color="default" size="sm">
                      {detail.evidence.length}
                    </Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="activity" className="whitespace-nowrap">
                    できごと
                    <Chip color={hasUnresolvedReject ? "danger" : "default"} size="sm">
                      {detail.events.length}
                    </Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="reports" className="pt-4">
                <ReportsTab
                  detail={detail}
                  focusReportId={focusReportId}
                  onOpenEvidence={setLightboxEvidenceId}
                  onOpenBuild={openBuild}
                />
              </Tabs.Panel>
              <Tabs.Panel id="builds" className="pt-4">
                <BuildsTab
                  detail={detail}
                  selectedBuildId={effectiveBuildId}
                  onSelectBuild={setSelectedBuildId}
                  onOpenEvidence={setLightboxEvidenceId}
                />
              </Tabs.Panel>
              <Tabs.Panel id="evidence" className="pt-4">
                <EvidenceTab
                  detail={detail}
                  onOpenEvidence={setLightboxEvidenceId}
                  onOpenBuild={openBuild}
                  onOpenReport={openReport}
                />
              </Tabs.Panel>
              <Tabs.Panel id="activity" className="pt-4">
                <ActivityTab
                  detail={detail}
                  filter={activityFilter}
                  onFilterChange={setActivityFilter}
                  onOpenBuild={openBuild}
                  onOpenReport={openReport}
                />
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </main>

      {detail !== null && lightboxEvidence !== null && (
        <Lightbox
          evidence={lightboxEvidence}
          build={detail.builds.find((b) => b.buildId === lightboxEvidence.buildId) ?? null}
          repoKey={detail.repoKey}
          onClose={() => setLightboxEvidenceId(null)}
          onOpenBuild={openBuild}
          onOpenReport={openReport}
        />
      )}
    </div>
  );
}

// 注意帯: 今、人が見るべきものだけを単票の一等地に出す(docs/dashboard-design.md「注意の導出」)。
// 無ければ何も出さない — 静けさが正常の表現
// 注意帯: 今、人が見るべきものだけを単票の一等地に出す。件数ではなく**対象そのものへのリンク**を置く —
// クリック1回で該当の報告カード(強調スクロール)・拒否のできごとに着地する。無ければ何も出さない
function AttentionBand({
  detail,
  onOpenRejections,
  onOpenReport,
}: {
  detail: RepoDetail;
  onOpenRejections: () => void;
  onOpenReport: (reportId: string) => void;
}) {
  const unresolved = detail.unresolvedRejections;
  const awaitingHuman = detail.reports.filter((r) => reportGroup(r.state) === "awaiting_human");
  const awaitingSubmit = detail.reports.filter((r) => reportGroup(r.state) === "awaiting_submit");
  // 取り込み待ち(導出): 提出済みだが、受け入れた sha がまだ origin のデフォルトブランチに入っていない
  const awaitingAdoption = detail.reports.filter((r) => r.adoption !== undefined && !r.adoption.entered);
  if (
    unresolved.length === 0 &&
    awaitingHuman.length === 0 &&
    awaitingSubmit.length === 0 &&
    awaitingAdoption.length === 0
  )
    return null;

  const latestRejectedReport = detail.reports.find((r) => r.reportId === unresolved[0]?.reportId);

  return (
    <div className="mt-3 grid gap-2">
      {unresolved.length > 0 && (
        <div className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-red-600/40 bg-red-600/8 px-3.5 py-2.5 text-[13px]">
          <button
            className="cursor-pointer font-semibold text-red-700 underline-offset-2 hover:underline dark:text-red-300"
            title="できごとタブの「拒否だけ」へ"
            onClick={onOpenRejections}
          >
            ✕ {UNRESOLVED_REJECTION_LABEL} {unresolved.length}件
          </button>
          <span className="min-w-0 text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">
            直近: {eventSentence(unresolved[0])}
            {unresolved[0].reason !== undefined && ` — ${unresolved[0].reason}`}
          </span>
          {latestRejectedReport !== undefined && (
            <ReportLink
              label={latestRejectedReport.title}
              title={`拒否された報告「${latestRejectedReport.title}」を開く`}
              onOpen={() => onOpenReport(latestRejectedReport.reportId)}
            />
          )}
        </div>
      )}
      {awaitingHuman.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-amber-500/50 bg-amber-500/8 px-3.5 py-2.5 text-[13px]">
          <span className="font-semibold text-amber-700 dark:text-amber-300">
            👤 {REPORT_GROUP_LABEL.awaiting_human} {awaitingHuman.length}件
          </span>
          {awaitingHuman.map((report) => (
            <ReportLink
              key={report.reportId}
              label={report.title}
              title={`報告「${report.title}」を開いて証拠を確認する`}
              onOpen={() => onOpenReport(report.reportId)}
            />
          ))}
        </div>
      )}
      {awaitingSubmit.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-black/10 px-3.5 py-2.5 text-[13px] dark:border-white/10">
          <span className="font-semibold text-zinc-600 dark:text-zinc-300">
            {REPORT_GROUP_LABEL.awaiting_submit} {awaitingSubmit.length}件
          </span>
          {awaitingSubmit.map((report) => (
            <ReportLink
              key={report.reportId}
              label={report.title}
              title={`報告「${report.title}」を開く(カードの提出ボタンから提出を記録できる)`}
              onOpen={() => onOpenReport(report.reportId)}
            />
          ))}
        </div>
      )}
      {awaitingAdoption.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-black/10 px-3.5 py-2.5 text-[13px] dark:border-white/10">
          <span
            className="font-semibold text-zinc-600 dark:text-zinc-300"
            title="提出済みだが、受け入れた sha がまだ origin のデフォルトブランチに入っていない(人間の番: PR 運用なら merge、main 直運用なら push)"
          >
            ⏳ {AWAITING_ADOPTION_LABEL} {awaitingAdoption.length}件
          </span>
          {awaitingAdoption.map((report) => (
            <ReportLink
              key={report.reportId}
              label={report.title}
              title={`報告「${report.title}」を開く(取り込みは人間の操作)`}
              onOpen={() => onOpenReport(report.reportId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
