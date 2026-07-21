import { Chip } from "@heroui/react";
import { CSSProperties, useEffect, useRef } from "react";
import { buildHue, humanTime } from "./lib";

// 録画証拠のインライン再生。autoplay はブラウザポリシー上 muted とセットでのみ許される。
// React は muted を DOM プロパティに反映しないことがあり autoplay が弾かれるため、ref で明示設定する。
// controls: 一覧サムネイルは false(カード全体がクリックで詳細を開くボタンなので、中に操作要素を置かない)、
//           詳細(Lightbox)は true(手動で再生位置を操作できる)
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
  return (
    <video
      ref={ref}
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      controls={controls}
      preload="metadata"
    />
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
