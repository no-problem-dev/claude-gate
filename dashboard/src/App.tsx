import { Chip, Tabs } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RepoDetail, RepoSummary, fetchJson } from "./lib";
import { Time } from "./components";
import { BuildsTab } from "./BuildsTab";
import { EvidenceTab } from "./EvidenceTab";
import { ActivityTab } from "./ActivityTab";
import { Lightbox } from "./Lightbox";

const POLL_MS = 5000;

export type Tab = "builds" | "evidence" | "activity";

export function App() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [selectedRepoKey, setSelectedRepoKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [tab, setTab] = useState<Tab>("builds");
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [lightboxEvidenceId, setLightboxEvidenceId] = useState<string | null>(null);
  const [daemonOk, setDaemonOk] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<{ repos: RepoSummary[] }>("/api/overview");
      setRepos(data.repos);
      setDaemonOk(true);
      setSelectedRepoKey((key) => key ?? data.repos[0]?.repoKey ?? null);
    } catch {
      setDaemonOk(false);
    }
  }, []);

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
        if (!cancelled) setDetail(data);
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
    if (repoKey === selectedRepoKey) return;
    setSelectedRepoKey(repoKey);
    setSelectedBuildId(null);
    setLightboxEvidenceId(null);
  };

  // 相互リンク: 証拠・できごとから属すビルドへ
  const openBuild = (buildId: string) => {
    setTab("builds");
    setSelectedBuildId(buildId);
    setLightboxEvidenceId(null);
  };

  const lightboxEvidence = detail?.evidence.find((e) => e.evidenceId === lightboxEvidenceId) ?? null;
  const hasReject = detail?.events.some((e) => e.result === "rejected") ?? false;

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
            <div className="flex gap-2.5 text-xs text-zinc-600 dark:text-zinc-300">
              <span>ビルド {repo.builds}</span>
              <span>証拠 {repo.evidence}</span>
              {repo.rejected > 0 && <span className="font-semibold text-red-600 dark:text-red-400">拒否 {repo.rejected}</span>}
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
        {detail === null ? (
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

            <Tabs
              className="mt-4"
              selectedKey={tab}
              onSelectionChange={(key) => setTab(key as Tab)}
            >
              <Tabs.ListContainer className="w-fit">
                <Tabs.List aria-label="オブジェクトの種類">
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
                    <Chip color={hasReject ? "danger" : "default"} size="sm">
                      {detail.events.length}
                    </Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="builds" className="pt-4">
                <BuildsTab
                  detail={detail}
                  selectedBuildId={effectiveBuildId}
                  onSelectBuild={setSelectedBuildId}
                  onOpenEvidence={setLightboxEvidenceId}
                />
              </Tabs.Panel>
              <Tabs.Panel id="evidence" className="pt-4">
                <EvidenceTab detail={detail} onOpenEvidence={setLightboxEvidenceId} onOpenBuild={openBuild} />
              </Tabs.Panel>
              <Tabs.Panel id="activity" className="pt-4">
                <ActivityTab detail={detail} onOpenBuild={openBuild} />
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
        />
      )}
    </div>
  );
}
