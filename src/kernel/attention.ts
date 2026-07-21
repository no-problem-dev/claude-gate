// 注意の導出(純関数)。記録は不変で全部残る — しかし記録の量は「今の状態」ではない。
// 「今、人が見るべきもの」だけをできごとから毎回計算する(docs/dashboard-design.md「注意の導出」)。

export interface AttentionEvent {
  tool: string;
  result: "ok" | "rejected";
  reportId?: string;
}

// 拒否のできごとが未解決 ⟺ その後に解消するできごとが無い:
// - 報告に紐づく拒否 → 同じ報告のその後の成功(どのツールでも)で解消。
//   報告が掃除で消えた場合・終着(提出済み)に達した場合も解消(終着した報告への拒否は壁であって、やることではない)
// - 報告に紐づかない拒否 → 同じツールのその後の成功で解消
export function unresolvedRejections<E extends AttentionEvent>(
  events: E[], // 時系列昇順
  reportStates: ReadonlyMap<string, string>, // reportId → 状態(存在する報告だけ)
): E[] {
  return events.filter((event, i) => {
    if (event.result !== "rejected") return false;
    const later = events.slice(i + 1);
    if (event.reportId !== undefined) {
      const state = reportStates.get(event.reportId);
      if (state === undefined || state === "submitted") return false;
      return !later.some((e) => e.result === "ok" && e.reportId === event.reportId);
    }
    return !later.some((e) => e.result === "ok" && e.tool === event.tool);
  });
}
