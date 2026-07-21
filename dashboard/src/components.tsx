import { Chip } from "@heroui/react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import {
  Build,
  Evidence,
  REPORT_STATE_COLOR,
  REPORT_STATE_LABEL,
  ReportState,
  buildHue,
  buildTitle,
  checkLabel,
  evidenceCaption,
  evidenceIcon,
  humanTime,
} from "./lib";

// 共有部品はこのファイルに集約する(タブのファイルに共有部品を定義しない — docs/dashboard-design.md「表現基盤」)。
// チップは3型: 状態(意味色)/ 分類(中立のアウトライン)/ 識別(ビルドのリング)。役割の違うものを同じ見た目にしない

// ---- 状態(StateChip) ----

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

// 報告の状態チップ。終着(提出済み)は塗りではなくアウトライン — 「終わった静けさ」を形で表す
export function ReportStateChip({ state }: { state: ReportState }) {
  if (state === "submitted") {
    return (
      <Chip color="success" variant="tertiary" size="sm" className="border border-green-600/40">
        ✓ {REPORT_STATE_LABEL.submitted}
      </Chip>
    );
  }
  return (
    <Chip color={REPORT_STATE_COLOR[state]} size="sm">
      {REPORT_STATE_LABEL[state]}
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

// ---- 分類(TaxonomyChip) ----

// 分類(確かめ方・変更の種類・証拠の種類)。意味色を使わず、状態チップとはアウトラインの形で区別する
export function TaxonomyChip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <Chip color="default" variant="tertiary" size="sm" className="border border-black/10 dark:border-white/10" title={title}>
      {children}
    </Chip>
  );
}

// ---- 識別(IdentityDot) ----

// ビルドの識別リング。色相は状態色の除外域から導出(lib.buildHue)。
// 塗りつぶしの状態バッジと形でも区別する。単独で意味を持たせない(ID・見出しの併記が前提)
export function BuildDot({ buildId, size = 10 }: { buildId: string; size?: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderColor: `oklch(0.62 0.14 ${buildHue(buildId)})`,
  };
  return <span className="build-dot" style={style} title="ビルドの識別色(状態ではない)" aria-hidden />;
}

// ---- オブジェクトへのリンク ----

// ビルドへのリンク: 識別リング + 「何の・いつのビルドか」の見出し
export function BuildLink({ build, onOpen }: { build: Build; onOpen: (buildId: string) => void }) {
  return (
    <button
      className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400"
      onClick={() => onOpen(build.buildId)}
    >
      <BuildDot buildId={build.buildId} size={8} />
      {buildTitle(build)}
    </button>
  );
}

// 報告へのリンク: 作業名のピル(必要なら動作番号つき)
export function ReportLink({
  label,
  title,
  onOpen,
}: {
  label: string;
  title?: string;
  onOpen: () => void;
}) {
  return (
    <button
      className="max-w-64 cursor-pointer truncate rounded-full border border-black/10 px-2.5 py-0.5 text-xs text-zinc-600 transition-colors hover:border-blue-500 hover:text-blue-600 dark:border-white/10 dark:text-zinc-300 dark:hover:text-blue-400"
      title={title}
      onClick={onOpen}
    >
      {label}
    </button>
  );
}

// ---- テキスト・レイアウトの基本部品 ----

export function Time({ iso, className = "" }: { iso: string; className?: string }) {
  const { text, title } = humanTime(iso);
  return (
    <time className={`text-xs whitespace-nowrap text-muted ${className}`} title={title} dateTime={iso}>
      {text}
    </time>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mt-5 mb-2 text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
      {children}
    </h4>
  );
}

// ラベルつきの事実表示(ビルドの素性・証拠のメタデータ)
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-widest text-zinc-500 uppercase dark:text-zinc-400">{label}</dt>
      <dd className="m-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// 長文の折りたたみ表示。既定は2行クランプ、クリックで全文
export function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <p
      className={`${open ? "" : "clamp-2"} cursor-pointer ${className}`}
      title={open ? "クリックで畳む" : "クリックで全文"}
      onClick={() => setOpen((v) => !v)}
    >
      {text}
    </p>
  );
}

// ---- 証拠の表示部品 ----

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

// 証拠のサムネイル(報告カバレッジ表・ビルド詳細のグリッドで使う)
export function EvidenceThumb({
  item,
  repoKey,
  onOpen,
}: {
  item: Evidence;
  repoKey: string;
  onOpen: (evidenceId: string) => void;
}) {
  const fileUrl = `/api/evidence/${repoKey}/${item.evidenceId}/file`;
  return (
    <button
      className="flex cursor-zoom-in flex-col overflow-hidden rounded-xl border border-black/10 text-left transition-colors hover:border-blue-500 dark:border-white/10"
      onClick={() => onOpen(item.evidenceId)}
    >
      {item.kind === "screenshot" ? (
        <img
          className="aspect-[9/12] w-full object-cover object-top"
          src={fileUrl}
          alt={item.note ?? "スクリーンショット証拠"}
          loading="lazy"
        />
      ) : item.kind === "video" ? (
        <EvidenceVideo src={fileUrl} className="aspect-[9/12] w-full bg-black object-contain" />
      ) : item.kind === "check_run" ? (
        <CheckRunGlance evidence={item} />
      ) : (
        <span className="grid aspect-[9/12] place-items-center text-3xl" aria-hidden>
          {evidenceIcon(item.kind)}
        </span>
      )}
      {item.kind !== "check_run" && (
        <span className="clamp-2 px-2.5 py-2 text-xs text-zinc-600 dark:text-zinc-300">{evidenceCaption(item)}</span>
      )}
    </button>
  );
}
