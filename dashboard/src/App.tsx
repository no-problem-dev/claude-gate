import { Alert, Button, Chip, Skeleton, Spinner, Tabs, Toast } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  REPORT_GROUP_LABEL,
  RepoDetail,
  RepoSummary,
  AWAITING_ADOPTION_LABEL,
  HttpError,
  UNRESOLVED_REJECTION_LABEL,
  eventSentence,
  fetchJson,
  foldReportStateEvents,
  reportGroup,
} from "./lib";
import { Hint, ReportLink, Time, WriteLockProvider } from "./components";
import { BuildsTab } from "./BuildsTab";
import { EvidenceTab } from "./EvidenceTab";
import { ActivityTab } from "./ActivityTab";
import { GuideView } from "./GuideView";
import { Lightbox } from "./Lightbox";
import { ReportsTab } from "./ReportsTab";
import { Tab, navigate, useRoute } from "./route";

const POLL_MS = 5000;

// 取得の失敗を「デーモンに届かない」と「デーモンは答えたが読めない」に分ける。
// 全部まとめて「デーモン応答なし」にすると、記録が無いのか繋がらないのかを人が切り分けられない。
// 生の原因(HTTP ステータス・例外文)は一次表示にしない — 読む人に意味が伝わらない
interface LoadFailure {
  message: string;
  raw: string;
  unreachable: boolean;
}

function describeFailure(error: unknown): LoadFailure {
  const raw = String(error);
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return {
        message: "このリポジトリの記録が見つかりません(掃除されたか、URL のリポジトリがこのマシンにありません)",
        raw,
        unreachable: false,
      };
    }
    return { message: "デーモンが記録を読めませんでした", raw, unreachable: false };
  }
  return {
    message: "デーモンに繋がりません(claude-gate のデーモンが動いているか確かめてください)",
    raw,
    unreachable: true,
  };
}

export function App() {
  const route = useRoute();
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [detailFailure, setDetailFailure] = useState<LoadFailure | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [daemonReachable, setDaemonReachable] = useState(true);
  // 狭い幅ではサイドバーが全幅で積まれて単票を画面外へ押し出すので、畳めるようにする
  const [navOpen, setNavOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<{ repos: RepoSummary[] }>("/api/overview");
      setRepos(data.repos);
      setDaemonReachable(true);
    } catch {
      setDaemonReachable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // 見ているリポジトリは URL が持つ。URL に無ければ先頭を既定にする(記録から導出。URL には書かない)
  const selectedRepoKey = route.repo ?? repos?.[0]?.repoKey ?? null;

  // 既定で解決した居場所は replace で URL に写す — 履歴を汚さずに、いま見ている場所を人に渡せる形にする
  useEffect(() => {
    if (route.repo === null && repos !== null && repos.length > 0) {
      navigate({ repo: repos[0].repoKey }, { replace: true });
    }
  }, [route.repo, repos]);

  useEffect(() => {
    if (selectedRepoKey === null) {
      setDetail(null);
      setDetailFailure(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    // 別のリポジトリの内容を見せない。読み込み中は骨組みを出す(ポーリングでは出さない)
    setDetail(null);
    setDetailFailure(null);
    setDetailLoading(true);
    const load = async () => {
      try {
        const data = await fetchJson<RepoDetail>(`/api/repos/${selectedRepoKey}`);
        if (cancelled) return;
        // 旧形式の report_state 行は受信時に原因行へ畳む(以後の全ビューが畳んだ形を見る)
        setDetail({ ...data, events: foldReportStateEvents(data.events) });
        setDetailFailure(null);
        setDaemonReachable(true);
      } catch (error) {
        if (cancelled) return;
        const failure = describeFailure(error);
        setDetailFailure(failure);
        if (failure.unreachable) setDaemonReachable(false);
      } finally {
        if (!cancelled) setDetailLoading(false);
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
  }, [selectedRepoKey, reloadToken]);

  const selectedSummary = repos?.find((r) => r.repoKey === selectedRepoKey);
  // タブの既定は「主役オブジェクトがあるか」で決める(報告があれば完了報告、無ければビルド)
  const hasReports = (selectedSummary?.reports ?? detail?.reports.length ?? 0) > 0;
  const tab: Tab = route.tab ?? (hasReports ? "reports" : "builds");

  // ビルドの選択: URL のビルドが今もあればそれ、無ければ先頭。ポーリング更新をまたいで保たれる
  const effectiveBuildId = useMemo(() => {
    if (detail === null) return null;
    if (route.build !== null && detail.builds.some((b) => b.buildId === route.build)) return route.build;
    return detail.builds[0]?.buildId ?? null;
  }, [detail, route.build]);

  const selectRepo = (repoKey: string) => {
    setNavOpen(false);
    navigate({
      view: "state",
      repo: repoKey,
      tab: null,
      build: null,
      report: null,
      evidence: null,
      events: "milestones",
    });
  };

  // 相互リンク: 証拠・できごとから属すビルドへ
  const openBuild = (buildId: string) =>
    navigate({ view: "state", tab: "builds", build: buildId, evidence: null });

  // 相互リンク: できごとから報告へ(完了報告タブで該当カードを強調してスクロール)
  const openReport = (reportId: string) =>
    navigate({ view: "state", tab: "reports", report: reportId, evidence: null });

  const openEvidence = (evidenceId: string) => navigate({ evidence: evidenceId });

  const lightboxEvidence = detail?.evidence.find((e) => e.evidenceId === route.evidence) ?? null;
  const hasUnresolvedReject = (detail?.unresolvedRejections.length ?? 0) > 0;

  return (
    <WriteLockProvider>
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[272px_1fr]">
        <aside
          id="repo-nav"
          className={`${navOpen ? "flex" : "hidden"} flex-col border-b border-black/10 bg-white/60 md:flex md:border-r md:border-b-0 md:sticky md:top-0 md:h-screen md:overflow-y-auto dark:border-white/10 dark:bg-white/3`}
        >
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
              route.view === "guide" ? "bg-black/5 dark:bg-white/8" : ""
            }`}
            onClick={() => {
              setNavOpen(false);
              navigate({ view: "guide", evidence: null });
            }}
          >
            <span aria-hidden>📖</span> この仕組みのガイド
          </button>

          <h2 className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
            リポジトリ
          </h2>
          {repos === null && (
            <div className="flex items-center gap-2 px-4 text-sm text-zinc-500 dark:text-zinc-400">
              <Spinner size="sm" /> 読み込み中…
            </div>
          )}
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
            <Chip color={daemonReachable ? "success" : "danger"} size="sm">
              {daemonReachable ? "● デーモン稼働中" : "● デーモン応答なし"}
            </Chip>
          </div>
        </aside>

        <main className="min-w-0 max-w-[1080px] px-5 pt-6 pb-16 md:px-7">
          <div className="mb-3 md:hidden">
            <Button
              size="sm"
              variant="outline"
              aria-expanded={navOpen}
              aria-controls="repo-nav"
              onPress={() => setNavOpen((v) => !v)}
            >
              {navOpen ? "✕ 一覧を閉じる" : "☰ リポジトリとガイド"}
            </Button>
          </div>

          {route.view === "guide" ? (
            <GuideView />
          ) : (
            <>
              {detail !== null && (
                <>
                  <header>
                    <h2 className="text-xl font-semibold tracking-tight">{detail.name}</h2>
                    <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {detail.commonDir.replace(/\/\.git$/, "")}
                    </p>
                  </header>

                  {/* 一度表示できたものは、更新に失敗しても消さない。更新できていない事実だけ添える */}
                  {detailFailure !== null && (
                    <LoadFailureAlert
                      failure={detailFailure}
                      title="表示は更新できていません"
                      onRetry={() => setReloadToken((n) => n + 1)}
                    />
                  )}

                  <AttentionBand
                    detail={detail}
                    onOpenRejections={() => navigate({ tab: "activity", events: "rejected" })}
                    onOpenReport={openReport}
                  />

                  <Tabs className="mt-4" selectedKey={tab} onSelectionChange={(key) => navigate({ tab: key as Tab })}>
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
                        focusReportId={route.report}
                        onOpenEvidence={openEvidence}
                        onOpenBuild={openBuild}
                      />
                    </Tabs.Panel>
                    <Tabs.Panel id="builds" className="pt-4">
                      <BuildsTab
                        detail={detail}
                        selectedBuildId={effectiveBuildId}
                        onSelectBuild={(buildId) => navigate({ build: buildId })}
                        onOpenEvidence={openEvidence}
                      />
                    </Tabs.Panel>
                    <Tabs.Panel id="evidence" className="pt-4">
                      <EvidenceTab
                        detail={detail}
                        onOpenEvidence={openEvidence}
                        onOpenBuild={openBuild}
                        onOpenReport={openReport}
                      />
                    </Tabs.Panel>
                    <Tabs.Panel id="activity" className="pt-4">
                      <ActivityTab
                        detail={detail}
                        filter={route.events}
                        onFilterChange={(events) => navigate({ events })}
                        onOpenBuild={openBuild}
                        onOpenReport={openReport}
                      />
                    </Tabs.Panel>
                  </Tabs>
                </>
              )}

              {detail === null && detailLoading && <DetailSkeleton />}

              {detail === null && !detailLoading && detailFailure !== null && (
                <LoadFailureAlert
                  failure={detailFailure}
                  title="記録を読めませんでした"
                  onRetry={() => setReloadToken((n) => n + 1)}
                />
              )}

              {/* 未選択: リポジトリが1つも無いときだけ起きる(選んでいるのに何も出ない、を作らない) */}
              {detail === null && !detailLoading && detailFailure === null && selectedRepoKey === null && (
                <div className="p-6 text-sm">
                  <p>まだ見張っているリポジトリがありません。</p>
                  <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                    エージェントがビルドを登録すると、ここに現れます。
                  </p>
                </div>
              )}
            </>
          )}
        </main>

        {detail !== null && lightboxEvidence !== null && (
          <Lightbox
            evidence={lightboxEvidence}
            build={detail.builds.find((b) => b.buildId === lightboxEvidence.buildId) ?? null}
            repoKey={detail.repoKey}
            onClose={() => navigate({ evidence: null })}
            onOpenBuild={openBuild}
            onOpenReport={openReport}
          />
        )}
      </div>
      {/* 書き込みの結果はここに出る。カードの中の一行は5秒ポーリングの再描画で消えるので使わない */}
      <Toast.Provider placement="bottom end" />
    </WriteLockProvider>
  );
}

// 読み込み中: 前の内容を消したときだけ出す骨組み。ポーリングの更新では出さない(画面が点滅する)
function DetailSkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="記録を読み込み中">
      <Skeleton className="h-7 w-56 rounded-lg" />
      <Skeleton className="h-4 w-80 rounded" />
      <Skeleton className="mt-3 h-10 w-72 rounded-xl" />
      <Skeleton className="h-44 w-full rounded-2xl" />
      <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Spinner size="sm" /> 記録を読み込んでいます…
      </p>
    </div>
  );
}

// 読めなかった: 何が起きたかを日本語の文で出し、原因の生文字列は畳んだ二次表示に置く。
// 再読み込みの導線を必ず添える — 直し方の分からない失敗表示を残さない
function LoadFailureAlert({
  failure,
  title,
  onRetry,
}: {
  failure: LoadFailure;
  title: string;
  onRetry: () => void;
}) {
  return (
    <Alert status="danger" role="alert" className="mt-4">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{failure.message}</Alert.Description>
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">詳しい原因</summary>
          <code className="mt-1 block font-mono text-[11.5px] break-all text-zinc-600 dark:text-zinc-300">
            {failure.raw}
          </code>
        </details>
      </Alert.Content>
      <Button size="sm" variant="secondary" onPress={onRetry}>
        再読み込み
      </Button>
    </Alert>
  );
}

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
          <Hint text="できごとタブの「拒否だけ」へ">
            <button
              className="cursor-pointer font-semibold text-red-700 underline-offset-2 hover:underline dark:text-red-300"
              onClick={onOpenRejections}
            >
              ✕ {UNRESOLVED_REJECTION_LABEL} {unresolved.length}件
            </button>
          </Hint>
          <span className="min-w-0 text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">
            直近: {eventSentence(unresolved[0])}
            {unresolved[0].reason !== undefined && ` — ${unresolved[0].reason}`}
          </span>
          {latestRejectedReport !== undefined && (
            <ReportLink
              label={latestRejectedReport.title}
              hint={`拒否された報告「${latestRejectedReport.title}」を開く`}
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
              hint={`報告「${report.title}」を開いて証拠を確認する`}
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
              hint={`報告「${report.title}」を開く(カードの提出ボタンから提出を記録できる)`}
              onOpen={() => onOpenReport(report.reportId)}
            />
          ))}
        </div>
      )}
      {awaitingAdoption.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-black/10 px-3.5 py-2.5 text-[13px] dark:border-white/10">
          <Hint text="提出済みだが、受け入れた sha がまだ origin のデフォルトブランチに入っていない(人間の番: PR 運用なら merge、main 直運用なら push)">
            <span className="font-semibold text-zinc-600 dark:text-zinc-300">
              ⏳ {AWAITING_ADOPTION_LABEL} {awaitingAdoption.length}件
            </span>
          </Hint>
          {awaitingAdoption.map((report) => (
            <ReportLink
              key={report.reportId}
              label={report.title}
              hint={`報告「${report.title}」を開く(取り込みは人間の操作)`}
              onOpen={() => onOpenReport(report.reportId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
