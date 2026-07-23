import { Card, Chip } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AWAITING_ADOPTION_LABEL,
  DELTA_CONFIRM_LABEL,
  ENTERED_DEFAULT_BRANCH_LABEL,
  Evidence,
  REPORT_GROUP_LABEL,
  Report,
  ReportGroup,
  RepoDetail,
  VERDICT_LABEL,
  changeKindLabel,
  checkLabel,
  eventSentence,
  formatTime,
  reportGroup,
} from "./lib";
import {
  AcceptBadge,
  ActionDialog,
  BuildLink,
  EvidenceThumb,
  ExpandableText,
  RejectBadge,
  ReportStateChip,
  SectionTitle,
  TaxonomyChip,
  Time,
} from "./components";

// 完了報告タブ: この仕組みの主役オブジェクト。
// 状態グループで並べる(人間確認待ち → 提出待ち → 進行中 → 終着)。「今、誰の番か」が先、個々のカードが後。
// 終着(提出済み)は既定で畳む — 終わったものが今の作業と同格に並ばない。
// カバレッジ表 = 動作ごとに「変更の種類 / 確かめ方 / 証拠 / 判定」(K-1 の人間向け表示)。
// 判定の reason(不合格の理由・確認できずの代替手段)は人間向けの出口なので動作の行に出す

const GROUP_ORDER: ReportGroup[] = ["awaiting_human", "awaiting_submit", "active", "terminal"];

export function ReportsTab({
  detail,
  focusReportId,
  onOpenEvidence,
  onOpenBuild,
}: {
  detail: RepoDetail;
  focusReportId: string | null;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
}) {
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        reports: detail.reports.filter((r) => reportGroup(r.state) === group),
      })).filter((g) => g.reports.length > 0),
    [detail.reports],
  );

  const [showTerminal, setShowTerminal] = useState(false);
  const focusInTerminal =
    focusReportId !== null &&
    detail.reports.some((r) => r.reportId === focusReportId && reportGroup(r.state) === "terminal");
  useEffect(() => {
    if (focusInTerminal) setShowTerminal(true);
  }, [focusInTerminal]);

  if (detail.reports.length === 0) {
    return (
      <div className="p-6 text-sm">
        <p>完了報告はまだありません。</p>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          エージェントが作業を始めるときに報告を開く(作業名と動作一覧を宣言する)と、ここに現れます。
        </p>
      </div>
    );
  }

  const renderCards = (reports: Report[]) => (
    <div className="grid gap-4">
      {reports.map((report) => (
        <ReportCard
          key={report.reportId}
          report={report}
          detail={detail}
          focused={report.reportId === focusReportId}
          onOpenEvidence={onOpenEvidence}
          onOpenBuild={onOpenBuild}
        />
      ))}
    </div>
  );

  return (
    <div className="grid gap-2">
      {groups.map(({ group, reports }) =>
        group === "terminal" ? (
          <section key={group}>
            <button
              className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-semibold tracking-widest text-zinc-500 uppercase transition-colors hover:bg-black/4 dark:text-zinc-400 dark:hover:bg-white/5"
              aria-expanded={showTerminal}
              onClick={() => setShowTerminal((v) => !v)}
            >
              <span aria-hidden>{showTerminal ? "▾" : "▸"}</span>
              {REPORT_GROUP_LABEL.terminal} {reports.length}件(提出済み)
            </button>
            {showTerminal && <div className="mt-2">{renderCards(reports)}</div>}
          </section>
        ) : (
          <section key={group}>
            <h3 className="mt-3 mb-2 px-1 text-xs font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
              {REPORT_GROUP_LABEL[group]} {reports.length}件
            </h3>
            {renderCards(reports)}
          </section>
        ),
      )}
    </div>
  );
}

function ReportCard({
  report,
  detail,
  focused,
  onOpenEvidence,
  onOpenBuild,
}: {
  report: Report;
  detail: RepoDetail;
  focused: boolean;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenBuild: (buildId: string) => void;
}) {
  // できごとから飛んできたときは該当カードへスクロールして強調(できごとはオブジェクトに従属する記録)
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused]);
  const evidenceByBehavior = useMemo(() => {
    const map = new Map<number, Evidence[]>();
    for (const link of report.evidence) {
      const item = detail.evidence.find((e) => e.evidenceId === link.evidenceId);
      if (!item) continue;
      const list = map.get(link.behaviorIndex) ?? [];
      list.push(item);
      map.set(link.behaviorIndex, list);
    }
    return map;
  }, [report.evidence, detail.evidence]);

  const covered = report.behaviors.filter((_, i) => (evidenceByBehavior.get(i + 1)?.length ?? 0) > 0).length;
  const ownEvents = detail.events.filter((e) => e.reportId === report.reportId).slice(0, 6);

  return (
    <div ref={cardRef} className="scroll-mt-4">
    <Card className={`p-5 ${focused ? "ring-2 ring-blue-500/60" : ""}`}>
      <header className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-base font-semibold">{report.title}</h3>
        <ReportStateChip state={report.state} />
        {report.branch !== undefined && (
          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400" title="作業ブランチ">
            {report.branch}
          </span>
        )}
        {report.judgment !== undefined && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400" title="判定した時刻">
            判定 {formatTime(report.judgment.judgedAt)}
          </span>
        )}
        {report.buildIds.length > 1 && (
          <Chip
            color="warning"
            size="sm"
            title="動作ごとに別のビルドの証拠が混ざっている。最新のビルドで全動作が動くことの保証にはならない"
          >
            ⚠ 複数ビルドの証拠が混在
          </Chip>
        )}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          動作 {covered}/{report.behaviors.length} が証拠で覆われている
        </span>
        <span className="ml-auto">
          <Time iso={report.openedAt} />
        </span>
      </header>

      {report.submission !== undefined && (
        <div className="mt-3 grid gap-1.5 rounded-xl border border-green-600/30 bg-green-600/8 p-3 text-[13px]">
          <p>
            {report.submission.prNumber !== undefined ? (
              <>
                <a href={report.submission.prUrl} target="_blank" rel="noreferrer" className="underline">
                  PR #{report.submission.prNumber}
                </a>
                (先頭 <span className="font-mono">{report.submission.sha.slice(0, 7)}</span>)をレビュー可能にした(
                {formatTime(report.submission.readiedAt ?? "")})。旧形式(提出がドラフト解除を実行していた頃)の記録。
              </>
            ) : report.submission.pushedAt !== undefined ? (
              <>
                {report.submission.remote}/{report.submission.branch} へ{" "}
                <span className="font-mono">{report.submission.sha.slice(0, 7)}</span> を push 済み(
                {formatTime(report.submission.pushedAt)})。旧形式(提出 = push)の記録。
              </>
            ) : (
              <>
                検証したソース <span className="font-mono">{report.submission.sha.slice(0, 7)}</span>{" "}
                を受け入れたと記録した({formatTime(report.submission.recordedAt ?? "")}
                {report.submission.via === "dashboard" && "・ダッシュボードから"})。
                取り込みに向かう操作(レビュー可能化・merge・デフォルトブランチへの push)はこの記録と照合される。
              </>
            )}
          </p>
          {report.adoption !== undefined &&
            (report.adoption.entered ? (
              <p
                className="text-[12.5px] text-zinc-600 dark:text-zinc-300"
                title="受け入れた sha が origin のデフォルトブランチの祖先(このマシンが最後に取得した時点の姿)"
              >
                ✓ {ENTERED_DEFAULT_BRANCH_LABEL}(origin/{report.adoption.defaultBranch})
              </p>
            ) : (
              <p
                className="text-[12.5px] font-medium text-amber-800 dark:text-amber-200"
                title="受け入れた sha がまだ origin のデフォルトブランチに入っていない"
              >
                ⏳ {AWAITING_ADOPTION_LABEL} — 人間の番です(PR 運用なら merge、main 直運用なら端末から push)
              </p>
            ))}
        </div>
      )}

      {report.judgment !== undefined && report.judgment.reasons.length > 0 && (
        <ul className="mt-3 grid gap-1 rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-[13px]">
          {report.judgment.reasons.map((reason, i) => (
            <li key={i}>⚠ {reason}</li>
          ))}
        </ul>
      )}

      {report.deltaConfirms !== undefined && report.deltaConfirms.length > 0 && (
        <ul className="mt-3 grid gap-1 rounded-xl border border-black/8 bg-black/3 p-3 text-[13px] dark:border-white/8 dark:bg-white/4">
          {report.deltaConfirms.map((dc, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              👤 {DELTA_CONFIRM_LABEL}{" "}
              <span className="font-mono text-xs">
                {dc.fromSha.slice(0, 7)} → {dc.toSha.slice(0, 7)}
              </span>{" "}
              — {dc.note}({formatTime(dc.confirmedAt)})
            </li>
          ))}
        </ul>
      )}

      {report.drift !== undefined && <DriftNotice report={report} detail={detail} />}
      {report.state === "unconfirmed" && <ConfirmForm report={report} detail={detail} />}
      {report.state === "passed" && <SubmitAction report={report} detail={detail} />}

      <SectionTitle>カバレッジ — 動作 × 証拠 × 判定</SectionTitle>
      <ol className="grid gap-2">
        {report.behaviors.map((entry, i) => {
          const index = i + 1;
          const evidence = evidenceByBehavior.get(index) ?? [];
          const verdict = report.judgment?.behaviors.find((b) => b.index === index);
          return (
            <li
              key={index}
              className="rounded-xl border border-black/8 p-3.5 dark:border-white/8"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-black/6 text-xs font-semibold dark:bg-white/10">
                  {index}
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-medium">{entry.behavior}</span>
                {entry.change_kind !== undefined && (
                  <TaxonomyChip title="変更の種類">{changeKindLabel(entry.change_kind)}</TaxonomyChip>
                )}
                <TaxonomyChip title="宣言した確かめ方">{checkLabel(entry.check)}</TaxonomyChip>
                {verdict !== undefined ? (
                  <Chip
                    color={verdict.verdict === "ok" ? "success" : verdict.verdict === "ng" ? "danger" : "warning"}
                    size="sm"
                  >
                    {verdict.verdict === "ok" ? "✓" : verdict.verdict === "ng" ? "✕" : "?"} {VERDICT_LABEL[verdict.verdict]}
                  </Chip>
                ) : evidence.length > 0 ? (
                  <Chip color="success" size="sm">
                    ✓ 証拠 {evidence.length}
                  </Chip>
                ) : (
                  <Chip color="warning" size="sm">
                    ⚠ 証拠なし
                  </Chip>
                )}
              </div>
              {verdict?.reason !== undefined && (
                <ExpandableText
                  text={verdict.reason}
                  className="mt-2 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300"
                />
              )}
              {evidence.length > 0 && (
                <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
                  {evidence.map((item) => (
                    <EvidenceThumb key={item.evidenceId} item={item} repoKey={detail.repoKey} onOpen={onOpenEvidence} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {report.buildIds.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[11px] tracking-widest text-zinc-500 uppercase dark:text-zinc-400">対象ビルド</span>
          {report.buildIds.map((buildId) => {
            const build = detail.builds.find((b) => b.buildId === buildId);
            return build !== undefined ? (
              <BuildLink key={buildId} build={build} onOpen={onOpenBuild} />
            ) : (
              <span key={buildId} className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {buildId.slice(0, 6)}(掃除済み)
              </span>
            );
          })}
        </div>
      )}

      {ownEvents.length > 0 && (
        <>
          <SectionTitle>この報告のできごと(直近{ownEvents.length}件 — 全量はできごとタブ)</SectionTitle>
          <ol>
            {ownEvents.map((event, i) => (
              <li
                key={`${event.ts}-${i}`}
                className="flex items-baseline gap-2 py-1 text-[13px] text-zinc-600 dark:text-zinc-300"
              >
                {event.result === "ok" ? <AcceptBadge /> : <RejectBadge />}
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {eventSentence(event)}
                  {event.reason && ` — ${event.reason}`}
                </span>
                <Time iso={event.ts} />
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
    </div>
  );
}

// 人間確認待ちの解決導線: 確認できずの動作を自分の目で確かめたら、その場で人間確認を記録する。
// 記録は証拠(kind: human_check)になり、自動で再判定される。入口は人間の操作面2つ —
// ダッシュボードのこのフォーム(判断材料 = 証拠を見ている場所で記録する)と CLI(セッション内の代筆・端末派向け)。
// どちらも同じべき等コアに合流するので、何度どこから記録しても状態は1つ(docs/dashboard-design.md「注意の導出」)
function ConfirmForm({ report, detail }: { report: Report; detail: RepoDetail }) {
  const targets = report.judgment?.behaviors.filter((b) => b.verdict === "unconfirmed").map((b) => b.index) ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  if (targets.length === 0) return null;
  const target = selected !== null && targets.includes(selected) ? selected : targets[0];
  const behavior = report.behaviors[target - 1]?.behavior ?? "";
  const worksite = detail.commonDir.replace(/\/\.git$/, "");
  const command = `claude-gate confirm "${worksite}" --report "${report.title}" --behavior ${target} --note "確認した内容"`;

  const record = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoKey: detail.repoKey,
          reportId: report.reportId,
          behaviorIndex: target,
          note: note.trim(),
        }),
      });
      const body = (await res.json()) as { status: string; note?: string; reason?: string };
      if (body.status === "ok") {
        setOutcome(`✓ ${body.note ?? "記録した"}`);
        setNote("");
      } else {
        setOutcome(`✕ ${body.reason ?? "記録できなかった"}`);
      }
    } catch (error) {
      setOutcome(`✕ 記録に失敗: ${String(error)}`);
    }
    setBusy(false);
    setDialogOpen(false);
  };

  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-[13px]">
      <p>
        解決するには: 動作を自分の目で確かめ、確認できたら人間確認を記録する(証拠になり、自動で再判定される)
      </p>
      {targets.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="確認する動作の選択">
          {targets.map((index) => (
            <button
              key={index}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                index === target
                  ? "border-amber-600/70 bg-amber-500/20 font-semibold text-amber-800 dark:text-amber-200"
                  : "border-black/10 text-zinc-600 hover:bg-black/4 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              }`}
              aria-pressed={index === target}
              onClick={() => setSelected(index)}
            >
              動作{index}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`confirm-note-${report.reportId}`}
          name="confirmNote"
          className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-600/70 dark:border-white/15 dark:bg-white/5"
          placeholder={`動作${target}を何でどう確認したか(記録の顔になる)`}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="cursor-pointer rounded-lg border border-amber-600/60 bg-amber-500/15 px-3 py-1.5 text-[13px] font-semibold text-amber-800 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-200"
          disabled={busy || note.trim() === ""}
          onClick={() => setDialogOpen(true)}
        >
          {busy ? "記録中…" : `動作${target}を確認した`}
        </button>
      </div>
      {outcome !== null && <p className="text-[12.5px] [overflow-wrap:anywhere]">{outcome}</p>}
      <details>
        <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">CLI で記録するなら</summary>
        <code className="mt-1 block font-mono text-[11.5px] break-all select-all text-zinc-600 dark:text-zinc-300">
          {command}
        </code>
      </details>
      <ActionDialog
        open={dialogOpen}
        title="人間確認を記録しますか?"
        description={
          <>
            報告「{report.title}」の動作{target}「{behavior}」に、
            <br />
            確認内容「{note.trim()}」を人間確認として記録します。
            <br />
            記録は証拠になり、自動で再判定されます(取り消しは claude-gate forget --evidence)。
          </>
        }
        actionLabel="記録する"
        busy={busy}
        onConfirm={() => void record()}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

// 提出待ち(合格)の解決導線: 人間がダッシュボードから提出を記録できる。
// 提出は記録だけの状態遷移(検証したソースを受け入れた事実)で、世界への実行を含まない。
// 条件はエージェント経由と同一(合格していること)— 入口が違うだけで門は同じ
function SubmitAction({ report, detail }: { report: Report; detail: RepoDetail }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoKey: detail.repoKey, reportId: report.reportId }),
      });
      const body = (await res.json()) as { status: string; note?: string; reason?: string; fix?: string };
      if (body.status === "ok") {
        setOutcome(`✓ ${body.note ?? "提出した"}`);
      } else {
        setOutcome(`✕ ${body.reason ?? "提出できなかった"}${body.fix !== undefined ? ` — 直し方: ${body.fix}` : ""}`);
      }
    } catch (error) {
      setOutcome(`✕ 提出に失敗: ${String(error)}`);
    }
    setBusy(false);
    setDialogOpen(false);
  };

  return (
    <div className="mt-3 grid gap-1.5 rounded-xl border border-green-600/30 bg-green-600/8 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          合格済み。提出すると「検証したソース
          {report.judgment?.sourceSha !== undefined && report.judgment.sourceSha !== null && (
            <>
              {" "}
              <span className="font-mono text-xs">{report.judgment.sourceSha.slice(0, 7)}</span>
            </>
          )}
          を受け入れた」と記録され、報告は終着する(取り込みに向かう操作がこの記録と照合される)
        </span>
        <button
          className="cursor-pointer rounded-lg border border-green-700/50 bg-green-600/15 px-3 py-1.5 text-[13px] font-semibold text-green-800 transition-colors hover:bg-green-600/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-green-300"
          disabled={busy}
          onClick={() => setDialogOpen(true)}
        >
          {busy ? "提出中…" : "提出する"}
        </button>
      </div>
      {outcome !== null && <p className="text-[12.5px] [overflow-wrap:anywhere]">{outcome}</p>}
      {report.drift === undefined && report.branch === undefined && (
        <DeltaConfirmSection report={report} detail={detail} />
      )}
      <ActionDialog
        open={dialogOpen}
        title="提出を記録しますか?"
        description={
          <>
            報告「{report.title}」の提出を記録します(検証したソースを受け入れた事実。push などの実行は含みません)。
            <br />
            提出済みの報告は終着で、もう変わりません。取り込みに向かう操作(レビュー可能化・merge・デフォルトブランチへの
            push)は、この記録と照合されるようになります。
          </>
        }
        actionLabel="記録する"
        busy={busy}
        onConfirm={() => void run()}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

// 差分確認の記録(POST /api/confirm-delta)。ずれバナーと旧報告向けフォームの共通処理
async function postConfirmDelta(
  repoKey: string,
  reportId: string,
  toSha: string,
  note: string,
): Promise<string> {
  try {
    const res = await fetch("/api/confirm-delta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoKey, reportId, toSha, note }),
    });
    const body = (await res.json()) as { status: string; note?: string; reason?: string; fix?: string };
    if (body.status === "ok") return `✓ ${body.note ?? "記録した"}`;
    return `✕ ${body.reason ?? "記録できなかった"}${body.fix !== undefined ? ` — 直し方: ${body.fix}` : ""}`;
  } catch (error) {
    return `✕ 記録に失敗: ${String(error)}`;
  }
}

// ずれの通知: 検証したソースの後に作業ブランチへコミットが積まれた事実を、発生した瞬間から見せる
// (提出の門で初めて発覚させない)。人間の動きは非同期 — 確認・引き受け・提出がこのカードだけで完結する。
// 合格している報告には差分確認(人間の引き受け)フォームを畳まずに出す。推奨は取り直しであることを明示
function DriftNotice({ report, detail }: { report: Report; detail: RepoDetail }) {
  const drift = report.drift;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  if (drift === undefined) return null;
  const sourceSha = report.judgment?.sourceSha ?? null;

  const record = async () => {
    setBusy(true);
    setOutcome(await postConfirmDelta(detail.repoKey, report.reportId, drift.tip, note.trim()));
    setNote("");
    setBusy(false);
    setDialogOpen(false);
  };

  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-[13px]">
      {!drift.ancestorOk ? (
        <p>
          検証したソース(<span className="font-mono text-xs">{sourceSha?.slice(0, 7)}</span>)がブランチ{" "}
          <span className="font-mono text-xs">{drift.branch}</span> の先端(
          <span className="font-mono text-xs">{drift.tip.slice(0, 7)}</span>
          )の祖先ではありません(rebase または巻き戻し)。{DELTA_CONFIRM_LABEL}の対象外 —
          いまの先端で証拠を取り直して judge し直してください。
        </p>
      ) : (
        <>
          <p>
            検証したソース(<span className="font-mono text-xs">{sourceSha?.slice(0, 7)}</span>)の後に、ブランチ{" "}
            <span className="font-mono text-xs">{drift.branch}</span> へ{drift.commits.length}
            コミット積まれています。判定はそのソースに対するものです。
            <strong>推奨はいまの先端での再検証(エージェントに取り直しを依頼)</strong>。
            差分を自分の目で見て、判定が引き続き有効だと言えるときだけ引き受けてください。
          </p>
          <ul className="grid gap-0.5 rounded-lg bg-black/4 p-2 font-mono text-[11.5px] dark:bg-white/5">
            {drift.commits.map((c) => (
              <li key={c.sha} className="[overflow-wrap:anywhere]">
                {c.sha.slice(0, 7)} {c.subject}
              </li>
            ))}
          </ul>
          {report.state === "passed" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`drift-note-${report.reportId}`}
                name="driftNote"
                className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-600/70 dark:border-white/15 dark:bg-white/5"
                placeholder="差分の何を見てどう判断したか(記録の顔になる)"
                value={note}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="cursor-pointer rounded-lg border border-amber-600/60 bg-amber-500/15 px-3 py-1.5 text-[13px] font-semibold text-amber-800 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-200"
                disabled={busy || note.trim() === ""}
                onClick={() => setDialogOpen(true)}
              >
                {busy ? "記録中…" : "差分を確認して引き受ける"}
              </button>
            </div>
          )}
          {outcome !== null && <p className="text-[12.5px] [overflow-wrap:anywhere]">{outcome}</p>}
          <ActionDialog
            open={dialogOpen}
            title={`${DELTA_CONFIRM_LABEL}を記録しますか?`}
            description={
              <>
                報告「{report.title}」の判定を、検証したソース{" "}
                <span className="font-mono text-xs">{sourceSha?.slice(0, 7)}</span> からブランチ先端{" "}
                <span className="font-mono text-xs">{drift.tip.slice(0, 7)}</span> まで({drift.commits.length}
                コミット)人間の責任で引き受けます。
                <br />
                記録は報告に残り、自動で再判定されます(提出の記録が指す検証済みソースがブランチ先端まで進みます)。
              </>
            }
            actionLabel="引き受ける"
            busy={busy}
            onConfirm={() => void record()}
            onClose={() => setDialogOpen(false)}
          />
        </>
      )}
    </div>
  );
}

// 差分確認(人間の引き受け)の導線 — 旧報告(ブランチ記録なし)向けのフォールバック。
// ずれの導出ができないので、開いたときに作業場基準の判断材料を取りに行く。
// 推奨は取り直し(いまの先端で再検証)— 引き受けは人間の責任であることを文面で明示する。
// 記録は報告に残り自動で再判定され、sourceSha が進む(submit の三点照合は変えない)
interface DeltaPreview {
  fromSha: string;
  toSha: string;
  branch: string | null;
  ancestorOk: boolean;
  commits: { sha: string; subject: string }[];
}

function DeltaConfirmSection({ report, detail }: { report: Report; detail: RepoDetail }) {
  const [preview, setPreview] = useState<DeltaPreview | { error: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const loadPreview = async () => {
    try {
      const res = await fetch(`/api/repos/${detail.repoKey}/reports/${report.reportId}/delta`);
      setPreview((await res.json()) as DeltaPreview | { error: string });
    } catch (error) {
      setPreview({ error: String(error) });
    }
  };

  const record = async () => {
    if (preview === null || "error" in preview) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/confirm-delta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoKey: detail.repoKey,
          reportId: report.reportId,
          toSha: preview.toSha,
          note: note.trim(),
        }),
      });
      const body = (await res.json()) as { status: string; note?: string; reason?: string; fix?: string };
      if (body.status === "ok") {
        setOutcome(`✓ ${body.note ?? "記録した"}`);
        setNote("");
      } else {
        setOutcome(`✕ ${body.reason ?? "記録できなかった"}${body.fix !== undefined ? ` — 直し方: ${body.fix}` : ""}`);
      }
    } catch (error) {
      setOutcome(`✕ 記録に失敗: ${String(error)}`);
    }
    setBusy(false);
    setDialogOpen(false);
  };

  const commitCount = preview !== null && !("error" in preview) ? preview.commits.length : 0;

  return (
    <details
      className="mt-1"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && preview === null) void loadPreview();
      }}
    >
      <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">
        検証後にコミットが動いていたら({DELTA_CONFIRM_LABEL} — 人間の引き受けで検証済みソースを先端まで進める)
      </summary>
      <div className="mt-2 grid gap-2 rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-[13px]">
        {preview === null && <p>ずれを調べています…</p>}
        {preview !== null && "error" in preview && <p>✕ {preview.error}</p>}
        {preview !== null && !("error" in preview) && preview.fromSha === preview.toSha && (
          <p>検証したソースと HEAD は一致しています。そのまま提出できます。</p>
        )}
        {preview !== null && !("error" in preview) && !preview.ancestorOk && preview.fromSha !== preview.toSha && (
          <p>
            検証したソース(<span className="font-mono text-xs">{preview.fromSha.slice(0, 7)}</span>)が、いまの HEAD(
            <span className="font-mono text-xs">{preview.toSha.slice(0, 7)}</span>
            {preview.branch !== null && (
              <>
                ・ブランチ <span className="font-mono text-xs">{preview.branch}</span>
              </>
            )}
            )の祖先ではありません。別の作業のブランチがチェックアウトされているか、rebase・巻き戻しが起きています。
            この報告の作業ブランチをチェックアウトしてから開き直してください。rebase・巻き戻しなら
            {DELTA_CONFIRM_LABEL}の対象外 — いまのソースで証拠を取り直して judge し直してください。
          </p>
        )}
        {preview !== null && !("error" in preview) && preview.ancestorOk && preview.fromSha !== preview.toSha && (
          <>
            <p>
              検証したソース(<span className="font-mono text-xs">{preview.fromSha.slice(0, 7)}</span>)の後に、
              {preview.branch !== null && (
                <>
                  ブランチ <span className="font-mono text-xs">{preview.branch}</span> に
                </>
              )}
              {preview.commits.length}コミット積まれています。
              <strong>推奨はいまの HEAD での再検証(エージェントに取り直しを依頼)</strong>
              です。差分を自分の目で見て、判定が引き続き有効だと言えるときだけ引き受けてください。
            </p>
            <ul className="grid gap-0.5 rounded-lg bg-black/4 p-2 font-mono text-[11.5px] dark:bg-white/5">
              {preview.commits.map((c) => (
                <li key={c.sha} className="[overflow-wrap:anywhere]">
                  {c.sha.slice(0, 7)} {c.subject}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`delta-note-${report.reportId}`}
                name="deltaNote"
                className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white/70 px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-600/70 dark:border-white/15 dark:bg-white/5"
                placeholder="差分の何を見てどう判断したか(記録の顔になる)"
                value={note}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="cursor-pointer rounded-lg border border-amber-600/60 bg-amber-500/15 px-3 py-1.5 text-[13px] font-semibold text-amber-800 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-200"
                disabled={busy || note.trim() === ""}
                onClick={() => setDialogOpen(true)}
              >
                {busy ? "記録中…" : "差分を確認して引き受ける"}
              </button>
            </div>
          </>
        )}
        {outcome !== null && <p className="text-[12.5px] [overflow-wrap:anywhere]">{outcome}</p>}
      </div>
      {preview !== null && !("error" in preview) && (
        <ActionDialog
          open={dialogOpen}
          title={`${DELTA_CONFIRM_LABEL}を記録しますか?`}
          description={
            <>
              報告「{report.title}」の判定を、検証したソース{" "}
              <span className="font-mono text-xs">{preview.fromSha.slice(0, 7)}</span> から{" "}
              <span className="font-mono text-xs">{preview.toSha.slice(0, 7)}</span> まで({commitCount}
              コミット)人間の責任で引き受けます。
              <br />
              記録は報告に残り、自動で再判定されます(提出の記録が指す検証済みソースが先まで進みます)。
            </>
          }
          actionLabel="引き受ける"
          busy={busy}
          onConfirm={() => void record()}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </details>
  );
}
