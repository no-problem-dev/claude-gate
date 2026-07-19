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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ⛩
          </span>
          <div>
            <h1>Claude Gate</h1>
            <p className="brand-sub">証拠つき完了報告</p>
          </div>
        </div>

        <h2 className="rail-title">リポジトリ</h2>
        {repos === null && <p className="muted pad-h">読み込み中…</p>}
        {repos !== null && repos.length === 0 && (
          <div className="empty pad-h">
            <p>まだ記録がありません。</p>
            <p className="muted small">エージェントがビルドを登録すると、ここに現れます。</p>
          </div>
        )}
        {(repos ?? []).map((repo) => (
          <button
            key={repo.repoKey}
            className={repo.repoKey === selectedRepoKey ? "repo-card selected" : "repo-card"}
            onClick={() => selectRepo(repo.repoKey)}
          >
            <div className="repo-card-head">
              <span className="repo-name">{repo.name}</span>
              <Time iso={repo.lastSeenAt} />
            </div>
            <div className="repo-card-counts">
              <span>ビルド {repo.builds}</span>
              <span>証拠 {repo.evidence}</span>
              {repo.rejected > 0 && <span className="text-critical">拒否 {repo.rejected}</span>}
            </div>
          </button>
        ))}

        <div className="sidebar-foot">
          <span className={daemonOk ? "pill pill-good" : "pill pill-critical"}>
            <span className="pill-dot" aria-hidden />
            {daemonOk ? "デーモン稼働中" : "デーモン応答なし"}
          </span>
        </div>
      </aside>

      <main className="main">
        {detail === null ? (
          <p className="muted pad">{repos?.length === 0 ? "" : "リポジトリを選択してください"}</p>
        ) : (
          <>
            <header className="repo-head">
              <div>
                <h2>{detail.name}</h2>
                <p className="muted small mono">{detail.commonDir.replace(/\/\.git$/, "")}</p>
              </div>
            </header>

            <nav className="tabs" aria-label="オブジェクトの種類">
              <TabButton current={tab} value="builds" onSelect={setTab} count={detail.builds.length}>
                ビルド
              </TabButton>
              <TabButton current={tab} value="evidence" onSelect={setTab} count={detail.evidence.length}>
                証拠
              </TabButton>
              <TabButton
                current={tab}
                value="activity"
                onSelect={setTab}
                count={detail.events.length}
                alert={detail.events.some((e) => e.result === "rejected")}
              >
                できごと
              </TabButton>
            </nav>

            {tab === "builds" && (
              <BuildsTab
                detail={detail}
                selectedBuildId={effectiveBuildId}
                onSelectBuild={setSelectedBuildId}
                onOpenEvidence={setLightboxEvidenceId}
              />
            )}
            {tab === "evidence" && (
              <EvidenceTab detail={detail} onOpenEvidence={setLightboxEvidenceId} onOpenBuild={openBuild} />
            )}
            {tab === "activity" && <ActivityTab detail={detail} onOpenBuild={openBuild} />}
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

function TabButton({
  current,
  value,
  onSelect,
  count,
  alert,
  children,
}: {
  current: Tab;
  value: Tab;
  onSelect: (tab: Tab) => void;
  count: number;
  alert?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={current === value ? "tab selected" : "tab"}
      onClick={() => onSelect(value)}
      aria-current={current === value}
    >
      {children}
      <span className={alert ? "tab-count tab-count-alert" : "tab-count"}>{count}</span>
    </button>
  );
}
