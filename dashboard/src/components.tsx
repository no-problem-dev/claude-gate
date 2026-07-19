import { Chip } from "@heroui/react";
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
    <Chip color="warning" size="sm" title="未コミットの変更を含む状態からビルドされた">
      ⚠ dirty
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
