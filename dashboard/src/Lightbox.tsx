import { Button } from "@heroui/react";
import { useEffect } from "react";
import { Build, Evidence, KIND_LABEL, buildTitle, formatTimeFull } from "./lib";
import { AcceptBadge, BuildDot, NeutralChip } from "./components";

// 証拠のシングルビュー: 原寸スクショ + 全メタデータ + 属すビルドへのリンク

export function Lightbox({
  evidence,
  build,
  repoKey,
  onClose,
  onOpenBuild,
}: {
  evidence: Evidence;
  build: Build | null;
  repoKey: string;
  onClose: () => void;
  onOpenBuild: (buildId: string) => void;
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
          ) : (
            <a className="p-12 text-lg" href={fileUrl} target="_blank" rel="noreferrer">
              {evidence.kind === "video" ? "🎞 ファイルを開く" : "🧩 ファイルを開く"}
            </a>
          )}
        </div>
        <aside className="overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <AcceptBadge />
            <NeutralChip>{KIND_LABEL[evidence.kind]}</NeutralChip>
          </div>
          {evidence.note && <p className="mt-2.5 text-[13px]">{evidence.note}</p>}

          {build !== null && (
            <button
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400"
              onClick={() => onOpenBuild(evidence.buildId)}
            >
              <BuildDot buildId={evidence.buildId} size={8} />
              {buildTitle(build)}
            </button>
          )}

          <dl className="mt-4 flex flex-col gap-2">
            <Meta label="受理">{formatTimeFull(evidence.attachedAt)}</Meta>
            <Meta label="アプリ">
              <span className="font-mono">{evidence.bundleId}</span>
            </Meta>
            <Meta label="シミュレータ">
              <span className="font-mono text-xs">{evidence.simulatorUdid}</span>
            </Meta>
            <Meta label="証拠ID">
              <span className="font-mono">{evidence.evidenceId}</span>
            </Meta>
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

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-widest text-zinc-500 uppercase dark:text-zinc-400">{label}</dt>
      <dd className="m-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
