import { AlertDialog, Button, Chip, Spinner, Tooltip } from "@heroui/react";
import { CSSProperties, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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

// ---- 書き込みロック(書き込みは直列 — docs/dashboard-design.md「やらないこと」) ----
// 非同期の書き込み(人間確認・差分確認・提出)が実行中は、全面のローディングを出して
// 全ての操作を受け付けない。各フォームは個別の busy を持たず、このロック1本に合流する。
// 読み取り(ポーリング)は止めない

interface WriteLock {
  writing: boolean;
  runWrite: (fn: () => Promise<void>) => Promise<void>;
}

const WriteLockContext = createContext<WriteLock | null>(null);

export function useWriteLock(): WriteLock {
  const lock = useContext(WriteLockContext);
  if (lock === null) throw new Error("WriteLockProvider の外で useWriteLock が呼ばれた");
  return lock;
}

export function WriteLockProvider({ children }: { children: React.ReactNode }) {
  const [writing, setWriting] = useState(false);
  // 実行中の再入は受け付けない。通常は全面の覆いが操作を止めているので来ない(二重防御)
  const writingRef = useRef(false);
  const runWrite = useCallback(async (fn: () => Promise<void>) => {
    if (writingRef.current) return;
    writingRef.current = true;
    setWriting(true);
    try {
      await fn();
    } finally {
      writingRef.current = false;
      setWriting(false);
    }
  }, []);
  return (
    <WriteLockContext.Provider value={{ writing, runWrite }}>
      {children}
      {writing && (
        // 覆いはモーダル(z-50)より上に置く。開いている確認ダイアログごと操作を止めないと
        // 「書き込みは直列」が守れない
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/35"
          role="status"
          aria-live="polite"
          aria-label="書き込み中"
        >
          <div className="bg-background flex items-center gap-3 rounded-2xl px-5 py-4 shadow-2xl">
            <Spinner size="sm" />
            <span className="text-[13px] font-medium">書き込み中…</span>
          </div>
        </div>
      )}
    </WriteLockContext.Provider>
  );
}

// ---- 補足の説明(Hint) ----

// 補足の説明。title 属性は使わない — キーボードでは読めず、タッチでは出ず、遅延も見た目も OS 任せ。
// 置ける場所に制限がある: Hint の入口は焦点を取れる要素なので、button の中には入れられない
// (button の中に操作できる要素を入れることになる)。button の中のチップは説明を持たず、
// 同じものが単独で出る場所(詳細ペイン等)に Hint を付ける
export function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content>{text}</Tooltip.Content>
    </Tooltip>
  );
}

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

export const DIRTY_EXPLANATION =
  "コミットしていない変更を含むソースからビルドされた(どのコミットの成果物か確定できない)";

export function DirtyChip() {
  return (
    <Chip color="warning" size="sm">
      ⚠ 未コミット変更あり
    </Chip>
  );
}

// 報告の状態チップ。終着(提出済み)は塗りではなくアウトライン — 完了済みで注意は不要、を形で表す
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

// 終了コードのバッジ: 0 = 通った(success)/ 非0 = 失敗(danger)。色名を文言に使わない。
// 通った・失敗は記号(✓ / ✕)と色で出す。読み上げには言葉で渡す — 記号だけでは意味が伝わらない
export function ExitCodeChip({ exitCode }: { exitCode?: number }) {
  const ok = exitCode === 0;
  return (
    <Chip color={ok ? "success" : "danger"} size="sm">
      <span className="sr-only">{ok ? "通った" : "失敗"}</span>
      <span aria-hidden>{ok ? "✓" : "✕"}</span> 終了コード {exitCode ?? "—"}
    </Chip>
  );
}

// ---- 分類(TaxonomyChip) ----

// 分類(確かめ方・変更の種類・証拠の種類)。意味色を使わず、状態チップとはアウトラインの形で区別する。
// hint は「この分類が何を指すか」の補足(Hint で出す。button の中では使えない)
export function TaxonomyChip({ children, hint }: { children: React.ReactNode; hint?: string }) {
  const chip = (
    <Chip color="default" variant="tertiary" size="sm" className="border border-black/10 dark:border-white/10">
      {children}
    </Chip>
  );
  return hint === undefined ? chip : <Hint text={hint}>{chip}</Hint>;
}

// ---- 識別(IdentityDot) ----

// ビルドの識別リング。色相は状態色の除外域から導出(lib.buildHue)。
// 塗りつぶしの状態バッジと形でも区別する。単独で意味を持たせない(ID・見出しの併記が前提)。
// 説明は持たせない: ほとんどの居場所が button の中(一覧の行・リンク)なので Hint を入れられず、
// 読み上げには何も足さない飾り。意味はビルドの詳細ペインの Hint が引き受ける
export const BUILD_DOT_EXPLANATION = "ビルドの識別色(状態ではない)。同じ色は同じビルド";

export function BuildDot({ buildId, size = 10 }: { buildId: string; size?: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderColor: `oklch(0.62 0.14 ${buildHue(buildId)})`,
  };
  return <span className="build-dot" style={style} aria-hidden />;
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

const REPORT_LINK_CLASS =
  "max-w-64 cursor-pointer truncate rounded-full border border-black/10 px-2.5 py-0.5 text-xs text-zinc-600 transition-colors hover:border-blue-500 hover:text-blue-600 dark:border-white/10 dark:text-zinc-300 dark:hover:text-blue-400";

// ビルドへの短いリンク(識別リング + 短縮ID)。できごとの行のように幅の無い場所で使う
export function BuildChip({ buildId, onOpen }: { buildId: string; onOpen: (buildId: string) => void }) {
  return (
    <Tooltip>
      <Tooltip.Trigger<"button">
        className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-zinc-600 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400"
        render={(props) => (
          <button {...props} onClick={() => onOpen(buildId)}>
            <BuildDot buildId={buildId} size={8} />
            <span className="font-mono text-xs">{buildId.slice(0, 6)}</span>
          </button>
        )}
      />
      <Tooltip.Content>ビルドを開く。{BUILD_DOT_EXPLANATION}</Tooltip.Content>
    </Tooltip>
  );
}

// 報告へのリンク: 作業名のピル(必要なら動作番号つき)。
// hint(クリックで何が起きるか)は Tooltip で出す。入口はこのボタン自身なので、
// Tooltip.Trigger の render でボタンそのものを入口にする(焦点を取れる要素を入れ子にしない)
export function ReportLink({
  label,
  hint,
  onOpen,
}: {
  label: string;
  hint?: string;
  onOpen: () => void;
}) {
  if (hint === undefined) {
    return (
      <button className={REPORT_LINK_CLASS} onClick={onOpen}>
        {label}
      </button>
    );
  }
  return (
    <Tooltip>
      <Tooltip.Trigger<"button">
        className={REPORT_LINK_CLASS}
        render={(props) => (
          <button {...props} onClick={onOpen}>
            {label}
          </button>
        )}
      />
      <Tooltip.Content>{hint}</Tooltip.Content>
    </Tooltip>
  );
}

// ---- アクションの確認ダイアログ ----

// ダッシュボードの書き込みアクション(人間確認の記録・差分確認・提出)は、必ずこのダイアログを挟んでから実行する。
// ワンクリックで状態が変わると誤操作の事故が起こる — 「何が起きるか」を見せて、実行はその上で。
// 開くのはボタンだけ(入力欄の Enter では開かない。日本語 IME の変換確定 Enter が誤発火する)。
//
// 覆いは HeroUI の AlertDialog に任せる: 焦点の閉じ込め・初期焦点・閉じたときの復帰・背後のスクロール停止を
// 自前の fixed inset-0 では持てなかった(aria-modal を書いても背後を Tab で歩けていた)。
// 最初に焦点が載るのは「やめる」— 開いた直後の Enter で書き込みが走らない並びにする
export function ActionDialog({
  open,
  title,
  description,
  actionLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  actionLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // 閉じているときは何も置かない。開いていない9個のダイアログを常時マウントしない
  if (!open) return null;
  return (
    <AlertDialog
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      {/* Esc と背景クリックで閉じる(書き込み中は背景クリックを受けない) */}
      <AlertDialog.Backdrop isDismissable={!busy} isKeyboardDismissDisabled={false}>
        <AlertDialog.Container size="md">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="text-[13px] leading-relaxed text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">
              {description}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="ghost" size="sm" onPress={onClose} isDisabled={busy}>
                やめる
              </Button>
              <Button size="sm" onPress={onConfirm} isDisabled={busy}>
                {busy ? "実行中…" : actionLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

// 人間の操作(人間確認・差分確認)で書く note の入力欄。
// ラベルは見える形で持つ — プレースホルダをラベルの代わりにすると、入力を始めた瞬間に
// 何を書く欄だったか分からなくなる。
// Enter では何も起きない: ダイアログを開くのはボタンだけ(日本語 IME の変換確定 Enter が誤発火する)
export function NoteField({
  id,
  name,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        className="min-w-0 rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-600/70 dark:border-white/15 dark:bg-white/5"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
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

// 長文の折りたたみ表示。既定は2行クランプ、押すと全文。
// 押せるものはボタンで書く — <p onClick> はキーボードで操作できず、読み上げにも押せると伝わらない
export function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={`${open ? "" : "clamp-2"} w-full cursor-pointer text-left ${className}`}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      {text}
    </button>
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
        // クランプと padding を同じ要素に載せない: line-clamp は行境界で切るが、
        // overflow の切り口は padding 端になるため、次の行が半分だけ padding 領域に見えてしまう
        <span className="block px-2.5 py-2" title={evidenceCaption(item)}>
          <span className="clamp-2 text-xs text-zinc-600 dark:text-zinc-300">{evidenceCaption(item)}</span>
        </span>
      )}
    </button>
  );
}
