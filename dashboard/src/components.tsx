import { Chip } from "@heroui/react";
import { CSSProperties, useEffect, useRef } from "react";
import { Evidence, buildHue, checkLabel, humanTime } from "./lib";

// 録画証拠の表示。
// サムネイル(controls=false): 先頭フレームの静止表示。自動再生しない(黒画面のカードが並ぶのを防ぐ。
//   loadedmetadata 直後に僅かにシークして最初のフレームを確実に描画させる)。▶ の目印を重ねる
// 詳細(Lightbox, controls=true): 自動再生 + 操作可。autoplay はブラウザポリシー上 muted とセットでのみ
//   許され、React は muted を DOM プロパティに反映しないことがあるため ref で明示設定する
export function EvidenceVideo({
  src,
  className = "",
  controls = false,
}: {
  src: string;
  className?: string;
  controls?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.muted = true;
  }, []);
  if (controls) {
    return <video ref={ref} className={className} src={src} autoPlay muted loop playsInline controls preload="metadata" />;
  }
  return (
    <span className="relative block">
      <video
        ref={ref}
        className={className}
        src={src}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = 0.001;
        }}
      />
      <span aria-hidden className="absolute inset-0 grid place-items-center">
        <span className="grid size-9 place-items-center rounded-full bg-black/55 text-sm text-white">▶</span>
      </span>
    </span>
  );
}

// ビルドの色の識別点。単独で意味を持たせない(ID・見出しの併記が前提)
export function BuildDot({ buildId, size = 10 }: { buildId: string; size?: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    background: `oklch(0.62 0.14 ${buildHue(buildId)})`,
  };
  return <span className="build-dot" style={style} aria-hidden />;
}

export function Time({ iso, className = "" }: { iso: string; className?: string }) {
  const { text, title } = humanTime(iso);
  return (
    <time className={`text-xs whitespace-nowrap text-muted ${className}`} title={title} dateTime={iso}>
      {text}
    </time>
  );
}

export function AcceptBadge() {
  return (
    <Chip color="success" size="sm">
      ✓ 受理
    </Chip>
  );
}

export function RejectBadge() {
  return (
    <Chip color="danger" size="sm">
      ✕ 拒否
    </Chip>
  );
}

export function DirtyChip() {
  return (
    <Chip
      color="warning"
      size="sm"
      title="コミットしていない変更を含むソースからビルドされた(どのコミットの成果物か確定できない)"
    >
      ⚠ 未コミット変更あり
    </Chip>
  );
}

export function NeutralChip({ children }: { children: React.ReactNode }) {
  return (
    <Chip color="default" size="sm">
      {children}
    </Chip>
  );
}

// 終了コードのバッジ: 0 = 通った(success)/ 非0 = 失敗(danger)。色名を文言に使わない
export function ExitCodeChip({ exitCode }: { exitCode?: number }) {
  const ok = exitCode === 0;
  return (
    <Chip color={ok ? "success" : "danger"} size="sm" title={ok ? "終了コード 0(通った)" : `終了コード ${exitCode}(失敗)`}>
      {ok ? "✓" : "✕"} 終了コード {exitCode ?? "—"}
    </Chip>
  );
}

// check_run のひと目要約(一覧のプレビュー領域で使う): 確かめ方 + 終了コードバッジ + サマリ一行。
// アイコン1文字より「何を実行して何が起きたか」が分かる
export function CheckRunGlance({ evidence }: { evidence: Evidence }) {
  const label = evidence.check !== undefined ? checkLabel(evidence.check) : "確かめ";
  const ok = evidence.exitCode === 0;
  return (
    <div className="flex h-full w-full flex-col gap-2 bg-black/4 p-3.5 text-left dark:bg-white/4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden>🧪</span>
        <span className="text-xs font-semibold">{label}</span>
        <ExitCodeChip exitCode={evidence.exitCode} />
      </div>
      {evidence.command !== undefined && (
        <code className="clamp-2 font-mono text-[11px] break-all text-zinc-500 dark:text-zinc-400">
          {evidence.command}
        </code>
      )}
      {evidence.headline !== undefined && (
        <p className={`clamp-3 font-mono text-[11px] break-all ${ok ? "" : "text-red-600 dark:text-red-400"}`}>
          {evidence.headline}
        </p>
      )}
    </div>
  );
}
