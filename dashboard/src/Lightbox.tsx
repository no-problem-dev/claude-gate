import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import {
  Build,
  EVIDENCE_KIND_LABEL,
  Evidence,
  checkLabel,
  evidenceCaption,
  evidenceIcon,
  formatTimeFull,
  isErrorLogLine,
} from "./lib";
import { AcceptBadge, BuildLink, EvidenceVideo, ExitCodeChip, Fact, ReportLink, TaxonomyChip } from "./components";

const MAX_LOG_LINES = 3000; // 巨大ログでも描画を軽く保つ。超過分は先頭を省略し末尾(失敗はここ)を見せる

// 証拠のシングルビュー: 原寸スクショ + 全メタデータ + 属すビルドへのリンク

export function Lightbox({
  evidence,
  build,
  repoKey,
  onClose,
  onOpenBuild,
  onOpenReport,
}: {
  evidence: Evidence;
  build: Build | null;
  repoKey: string;
  onClose: () => void;
  onOpenBuild: (buildId: string) => void;
  onOpenReport: (reportId: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fileUrl = `/api/evidence/${repoKey}/${evidence.evidenceId}/file`;

  return (
    <div
      className="fixed inset-0 z-10 grid place-items-center bg-black/55 p-8"
      role="dialog"
      aria-modal="true"
      aria-label="証拠の詳細"
      onClick={onClose}
    >
      <div
        className="bg-background relative grid max-h-[calc(100vh-64px)] w-full max-w-[900px] grid-cols-1 overflow-hidden rounded-2xl shadow-2xl sm:grid-cols-[minmax(0,1.4fr)_minmax(240px,1fr)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid min-h-60 place-items-center bg-black/4 dark:bg-white/4">
          {evidence.kind === "screenshot" ? (
            <img
              className="block max-h-[calc(100vh-64px)] max-w-full object-contain"
              src={fileUrl}
              alt={evidence.note ?? "スクリーンショット証拠"}
            />
          ) : evidence.kind === "video" ? (
            <EvidenceVideo
              className="block max-h-[calc(100vh-64px)] max-w-full bg-black object-contain"
              src={fileUrl}
              controls
            />
          ) : evidence.kind === "check_run" ? (
            <CheckRunLog url={fileUrl} exitCode={evidence.exitCode} check={evidence.check} />
          ) : (
            <a className="p-12 text-lg" href={fileUrl} target="_blank" rel="noreferrer">
              {evidenceIcon(evidence.kind)} ファイルを開く
            </a>
          )}
        </div>
        <aside className="overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <AcceptBadge />
            <TaxonomyChip>{EVIDENCE_KIND_LABEL[evidence.kind]}</TaxonomyChip>
          </div>
          <p className="mt-2.5 text-[13px]">{evidenceCaption(evidence)}</p>

          {evidence.usedBy !== undefined && evidence.usedBy.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {evidence.usedBy.map((use) => (
                <ReportLink
                  key={`${use.reportId}-${use.behaviorIndex}`}
                  label={`${use.reportTitle} · 動作${use.behaviorIndex}`}
                  title={`報告「${use.reportTitle}」の動作${use.behaviorIndex}を覆う証拠。クリックで報告へ`}
                  onOpen={() => {
                    onOpenReport(use.reportId);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}

          {build !== null && evidence.buildId !== undefined && (
            <div className="mt-1.5">
              <BuildLink build={build} onOpen={onOpenBuild} />
            </div>
          )}

          <dl className="mt-4 flex flex-col gap-2">
            <Fact label="受理">{formatTimeFull(evidence.attachedAt)}</Fact>
            {evidence.kind === "check_run" ? (
              <>
                <Fact label="確かめ方">{evidence.check !== undefined ? checkLabel(evidence.check) : "—"}</Fact>
                <Fact label="コマンド">
                  <span className="font-mono text-xs">{evidence.command}</span>
                </Fact>
                <Fact label="終了コード">
                  <span className="font-mono">{evidence.exitCode}</span>
                </Fact>
                <Fact label="ソース">
                  <span className="font-mono text-xs">
                    {evidence.gitSha ? evidence.gitSha.slice(0, 10) : "コミットなし"}
                    {evidence.dirty === true && "(+未コミットの変更あり)"}
                  </span>
                </Fact>
              </>
            ) : (
              <>
                <Fact label="アプリ">
                  <span className="font-mono">{evidence.bundleId}</span>
                </Fact>
                <Fact label="シミュレータ">
                  <span className="font-mono text-xs">{evidence.simulatorUdid}</span>
                </Fact>
              </>
            )}
            <Fact label="証拠ID">
              <span className="font-mono">{evidence.evidenceId}</span>
            </Fact>
          </dl>
        </aside>
        <Button
          className="absolute top-2.5 right-2.5"
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={onClose}
          aria-label="閉じる"
        >
          ✕
        </Button>
      </div>
    </div>
  );
}

// check_run のログ全文をインライン表示する。失敗行(error: / signal / FAILED 等)は赤でハイライト。
// ログ全文は詳細を開いたときだけ file エンドポイントから取得する(一覧では headline だけ)
function CheckRunLog({ url, exitCode, check }: { url: string; exitCode?: number; check?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => alive && setText(body))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [url]);

  const allLines = (text ?? "").split("\n");
  const truncated = allLines.length > MAX_LOG_LINES;
  const lines = truncated ? allLines.slice(allLines.length - MAX_LOG_LINES) : allLines;

  return (
    <div className="flex h-full max-h-[calc(100vh-64px)] w-full flex-col self-stretch bg-zinc-950 text-left">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span aria-hidden>🧪</span>
        <span className="text-xs font-semibold text-zinc-200">
          {check !== undefined ? checkLabel(check) : "確かめ"}の出力ログ
        </span>
        <ExitCodeChip exitCode={exitCode} />
        <a
          className="ml-auto text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          生ログを開く
        </a>
      </div>
      {error !== null ? (
        <p className="p-4 text-sm text-red-400">ログを読めませんでした: {error}</p>
      ) : text === null ? (
        <p className="p-4 text-sm text-zinc-400">ログを読み込み中…</p>
      ) : (
        <div className="overflow-auto">
          {truncated && (
            <p className="px-4 py-2 text-[11px] text-amber-400">
              先頭を省略しました(末尾 {MAX_LOG_LINES} 行を表示 / 全 {allLines.length} 行)。全体は「生ログを開く」から
            </p>
          )}
          <pre className="px-4 py-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-zinc-200">
            {lines.map((line, i) => (
              <div key={i} className={isErrorLogLine(line) ? "text-red-400" : undefined}>
                {line === "" ? " " : line}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

