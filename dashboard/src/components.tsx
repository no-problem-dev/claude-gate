import { CSSProperties } from "react";
import { buildHue, humanTime } from "./lib";

// ビルドの色の識別点。単独で意味を持たせない(ID・見出しの併記が前提)
export function BuildDot({ buildId, size = 10 }: { buildId: string; size?: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    background: `oklch(0.62 0.14 ${buildHue(buildId)})`,
  };
  return <span className="build-dot" style={style} aria-hidden />;
}

export function Time({ iso }: { iso: string }) {
  const { text, title } = humanTime(iso);
  return (
    <time className="muted small nowrap" title={title} dateTime={iso}>
      {text}
    </time>
  );
}

export function AcceptBadge() {
  return <span className="badge badge-good">✓ 受理</span>;
}

export function RejectBadge() {
  return <span className="badge badge-critical">✕ 拒否</span>;
}

export function DirtyChip() {
  return (
    <span className="chip chip-warning" title="未コミットの変更を含む状態からビルドされた">
      ⚠ dirty
    </span>
  );
}
