import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Build,
  Evidence,
  GateEvent,
  KIND_LABEL,
  RepoDetail,
  RepoSummary,
  fetchJson,
  formatTime,
  timeAgo,
} from "./lib";

const POLL_MS = 5000;

export function App() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [daemonOk, setDaemonOk] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<{ repos: RepoSummary[] }>("/api/overview");
      setRepos(data.repos);
      setDaemonOk(true);
      setUpdatedAt(new Date());
      setSelectedKey((key) => key ?? data.repos[0]?.repoKey ?? null);
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
    if (selectedKey === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchJson<RepoDetail>(`/api/repos/${selectedKey}`);
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
  }, [selectedKey]);

  const totals = useMemo(() => {
    const list = repos ?? [];
    return {
      repos: list.length,
      builds: list.reduce((n, r) => n + r.builds, 0),
      evidence: list.reduce((n, r) => n + r.evidence, 0),
      rejected: list.reduce((n, r) => n + r.rejected, 0),
    };
  }, [repos]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ⛩
          </span>
          <div>
            <h1>Claude Gate</h1>
            <p className="brand-sub">証拠つき完了報告の状態</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className={daemonOk ? "pill pill-good" : "pill pill-critical"}>
            <span className="pill-dot" aria-hidden />
            {daemonOk ? "デーモン稼働中" : "デーモン応答なし"}
          </span>
          {updatedAt && <span className="muted">更新 {updatedAt.toLocaleTimeString("ja-JP")}</span>}
        </div>
      </header>

      <section className="stats" aria-label="全体の数">
        <StatTile label="リポジトリ" value={totals.repos} />
        <StatTile label="登録ビルド" value={totals.builds} />
        <StatTile label="受理された証拠" value={totals.evidence} />
        <StatTile label="拒否" value={totals.rejected} tone={totals.rejected > 0 ? "critical" : undefined} />
      </section>

      <main className="layout">
        <nav className="rail" aria-label="リポジトリ一覧">
          <h2 className="rail-title">リポジトリ</h2>
          {repos === null && <p className="muted pad">読み込み中…</p>}
          {repos !== null && repos.length === 0 && (
            <div className="empty pad">
              <p>まだ記録がありません。</p>
              <p className="muted">
                エージェントが register_build を呼ぶと、ここにリポジトリが現れます。
              </p>
            </div>
          )}
          {(repos ?? []).map((repo) => (
            <button
              key={repo.repoKey}
              className={repo.repoKey === selectedKey ? "repo-card selected" : "repo-card"}
              onClick={() => setSelectedKey(repo.repoKey)}
            >
              <div className="repo-card-head">
                <span className="repo-name">{repo.name}</span>
                <span className="muted small">{timeAgo(repo.lastSeenAt)}</span>
              </div>
              <div className="repo-card-counts">
                <span>ビルド {repo.builds}</span>
                <span>証拠 {repo.evidence}</span>
                {repo.rejected > 0 && <span className="text-critical">拒否 {repo.rejected}</span>}
              </div>
            </button>
          ))}
        </nav>

        <section className="detail">
          {detail === null && <p className="muted pad">リポジトリを選択してください</p>}
          {detail !== null && <RepoView detail={detail} />}
        </section>
      </main>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "critical" }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className={tone === "critical" ? "stat-value text-critical" : "stat-value"}>{value}</span>
    </div>
  );
}

function RepoView({ detail }: { detail: RepoDetail }) {
  const evidenceByBuild = useMemo(() => {
    const map = new Map<string, Evidence[]>();
    for (const item of detail.evidence) {
      const list = map.get(item.buildId) ?? [];
      list.push(item);
      map.set(item.buildId, list);
    }
    return map;
  }, [detail.evidence]);

  return (
    <>
      <div className="detail-head">
        <h2>{detail.name}</h2>
        <span className="muted small mono">{detail.commonDir.replace(/\/\.git$/, "")}</span>
      </div>

      <h3 className="section-title">ビルドと証拠</h3>
      {detail.builds.length === 0 && <p className="muted">登録されたビルドはまだありません</p>}
      <div className="build-list">
        {detail.builds.map((build) => (
          <BuildCard
            key={build.buildId}
            build={build}
            evidence={evidenceByBuild.get(build.buildId) ?? []}
            repoKey={detail.repoKey}
          />
        ))}
      </div>

      <h3 className="section-title">できごと</h3>
      <EventFeed events={detail.events} />
    </>
  );
}

function BuildCard({ build, evidence, repoKey }: { build: Build; evidence: Evidence[]; repoKey: string }) {
  return (
    <article className="build-card">
      <div className="build-head">
        <span className="mono build-id">{build.buildId}</span>
        {build.scheme && <span className="chip">{build.scheme}</span>}
        {build.configuration && <span className="chip">{build.configuration}</span>}
        {build.dirty && (
          <span className="chip chip-warning" title="未コミットの変更を含む状態からビルドされた">
            ⚠ dirty
          </span>
        )}
        <span className="muted small right">{formatTime(build.registeredAt)}</span>
      </div>
      <div className="build-meta muted small mono">
        {build.gitSha ? build.gitSha.slice(0, 10) : "コミットなし"}
      </div>
      {evidence.length === 0 ? (
        <p className="muted small">証拠なし — このビルドではまだ何も受理されていません</p>
      ) : (
        <div className="evidence-list">
          {evidence.map((item) => (
            <EvidenceCard key={item.evidenceId} item={item} repoKey={repoKey} />
          ))}
        </div>
      )}
    </article>
  );
}

function EvidenceCard({ item, repoKey }: { item: Evidence; repoKey: string }) {
  const fileUrl = `/api/evidence/${repoKey}/${item.evidenceId}/file`;
  return (
    <figure className="evidence-card">
      {item.kind === "screenshot" ? (
        <a href={fileUrl} target="_blank" rel="noreferrer">
          <img src={fileUrl} alt={item.note ?? "スクリーンショット証拠"} loading="lazy" />
        </a>
      ) : (
        <div className="evidence-file-icon" aria-hidden>
          {item.kind === "video" ? "🎞" : "🧩"}
        </div>
      )}
      <figcaption>
        <div className="evidence-head">
          <span className="badge badge-good">✓ 受理</span>
          <span className="chip">{KIND_LABEL[item.kind]}</span>
          <span className="muted small right">{formatTime(item.attachedAt)}</span>
        </div>
        {item.note && <p className="evidence-note">{item.note}</p>}
        <p className="muted small mono">
          {item.evidenceId} · {item.bundleId}
        </p>
      </figcaption>
    </figure>
  );
}

function EventFeed({ events }: { events: GateEvent[] }) {
  if (events.length === 0) return <p className="muted">記録はまだありません</p>;
  return (
    <ol className="event-feed">
      {events.map((event, i) => (
        <li key={`${event.ts}-${i}`} className="event-row">
          <span className={event.result === "ok" ? "badge badge-good" : "badge badge-critical"}>
            {event.result === "ok" ? "✓ 受理" : "✕ 拒否"}
          </span>
          <span className="event-tool mono">{event.tool}</span>
          <span className="event-body">
            {event.result === "rejected"
              ? (event.reason ?? "")
              : [
                  event.buildId && `ビルド ${event.buildId}`,
                  event.evidenceId && `証拠 ${event.evidenceId}`,
                  (event.alreadyRegistered || event.alreadyAttached) && "(既存の記録を返却)",
                ]
                  .filter(Boolean)
                  .join(" ")}
          </span>
          <span className="muted small right nowrap">{formatTime(event.ts)}</span>
        </li>
      ))}
    </ol>
  );
}
