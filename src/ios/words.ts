// 語彙の定義: 日本語の正式名と英語識別子の 1:1 対訳。ここにない語は実装に登場させない。
// ダッシュボードもこのファイルを直接 import する(ラベルの写しを UI 側に持たない)。

export type Verdict = "ok" | "ng" | "unconfirmed";

// 動作の判定の正式名。OK・NG は日本語の日常語として正式採用(層の違う報告の判定 合格/不合格 と混ぜない)
export const VERDICT_LABEL: Record<Verdict, string> = {
  ok: "OK",
  ng: "NG",
  unconfirmed: "確認できず",
};

// 証拠の種類。check_run(確かめの記録)はゲート自身がコマンドを実行した結果(2b)。
// device_report(実機レポート)は実機で走ったアプリ自身のセルフレポート(console 出力等) —
// 実機からは .app を取り出せないので、出所照合はビルドの中身ハッシュではなく Mach-O UUID で行う
// human_check(人間確認)は**人間だけが作れる証拠**(CLI `claude-gate confirm`)。
// エージェントの語彙(MCP ツール)には入れない — attach_evidence の kind からも型・スキーマ両方で除外。
// 人間は最上位の検証器: 機械に見えない動作(human_check 宣言・見えないこと台帳・動きの質)は、
// 人間確認の証拠が付いたときだけ判定が OK になる
export type EvidenceKind = "screenshot" | "ui_snapshot" | "video" | "check_run" | "device_report" | "human_check";

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  screenshot: "スクリーンショット",
  ui_snapshot: "UI スナップショット",
  video: "録画",
  check_run: "確かめの記録",
  device_report: "実機レポート",
  human_check: "人間確認",
};

// ビルド: 検証対象の成果物。buildId は成果物の中身から計算する(git の commit ID と同じ仕組み)
// 記録は最初の登録時の事実で固定される(不変)。再登録時は応答の note で既登録を明示する
export interface Build {
  buildId: string; // 表示・参照用の短縮形(先頭12文字)
  buildIdFull: string; // 照合はこちらで行う
  appPath: string;
  gitSha: string | null;
  dirty: boolean;
  machoUuids: string[]; // 実行バイナリの Mach-O UUID(LC_UUID・arch ごと)。実機レポートの出所照合に使う
  scheme?: string;
  configuration?: string;
  registeredAt: string;
}

// 証拠: 1件の観測記録。出所を持つ。
// シミュレータ観測(screenshot / ui_snapshot / video)・実機レポート(device_report)の出所は
// 「どのビルドを見たか」、確かめの記録(check_run)の出所は「どのソースでコマンドを実行したか」
export interface Evidence {
  evidenceId: string; // 中身から決まる(べき等)
  kind: EvidenceKind;
  storedFile: string; // 不変コピー(check_run は出力ログ)の場所
  note?: string;
  attachedAt: string;
  // シミュレータ観測・実機レポートのみ
  buildId?: string;
  sourceFile?: string; // 観測ファイルの元の場所
  simulatorUdid?: string;
  deviceUdid?: string; // 実機レポート(device_report)のみ
  bundleId?: string;
  // 確かめの記録(check_run)のみ
  check?: CheckKind;
  command?: string;
  exitCode?: number; // 終了コードが事実。ok/ng の解釈は判定(judge)の領分
  gitSha?: string | null;
  dirty?: boolean;
}

// 完了報告の状態(ドメインモデル §3.2)。提出済み(submitted)が終着
export type ReportState = "draft" | "evidenced" | "passed" | "failed" | "unconfirmed" | "submitted";

export const REPORT_STATE_LABEL: Record<ReportState, string> = {
  draft: "下書き",
  evidenced: "証拠あり",
  passed: "合格",
  failed: "不合格",
  unconfirmed: "確認できず",
  submitted: "提出済み",
};

// 報告のグループ: 状態からの導出(読み取りモデルで計算し、保存しない)。
// 「今、誰の番か」を表す — 人間確認待ち(人間)/ 提出待ち・進行中(エージェント)/ 終着(誰の番でもない)
export type ReportGroup = "awaiting_human" | "awaiting_submit" | "active" | "terminal";

export const REPORT_GROUP_LABEL: Record<ReportGroup, string> = {
  awaiting_human: "人間確認待ち",
  awaiting_submit: "提出待ち",
  active: "進行中",
  terminal: "終着",
};

export function reportGroup(state: ReportState): ReportGroup {
  if (state === "submitted") return "terminal";
  if (state === "unconfirmed") return "awaiting_human";
  if (state === "passed") return "awaiting_submit";
  return "active"; // 下書き・証拠あり・不合格 = 作業の続き
}

// 未解決(unresolved): 拒否のできごとに、その後の解消が無い状態。
// 解消 = 同じ報告のその後の成功(どのツールでも)・報告の掃除・報告の終着。
// 報告に紐づかない拒否は同じツールのその後の成功で解消。
// 導出の本体は kernel/attention.ts(純関数)。記録は不変、注意は毎回計算する
export const UNRESOLVED_REJECTION_LABEL = "未解決の拒否";

// 確かめ方の語彙(ios-task-loop.md §3 対応表と 1:1)。
// 自由文字列だと判定(2b)で下限と比較できない — 語彙外の確かめ方は宣言に使えない
export const CHECK_KINDS = [
  "compile", // コンパイル
  "unit_test", // ユニットテスト
  "screenshot", // スクショ
  "interaction_log", // 操作記録(操作列 + 結果スクショ)
  "ui_test", // UIテスト(XCUITest)
  "video", // 録画
  "launch_check", // 起動確認
  "device_report", // 実機レポート(実機で走ったアプリ自身のセルフレポート)
  "human_check", // 人間確認
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const CHECK_LABEL: Record<CheckKind, string> = {
  compile: "コンパイル",
  unit_test: "ユニットテスト",
  screenshot: "スクショ",
  interaction_log: "操作記録",
  ui_test: "UIテスト",
  video: "録画",
  launch_check: "起動確認",
  device_report: "実機レポート",
  human_check: "人間確認",
};

// 変更の種類の語彙(ios-task-loop.md §3 対応表と 1:1)。
// K-7「確かめ方が下限以上か」は、何の変更かが宣言されないと機械比較できない
export const CHANGE_KINDS = [
  "logic", // ロジック
  "appearance", // 見た目
  "interaction", // 操作・遷移
  "motion", // 動き
  "data", // データ
  "contract", // 契約
  "config", // 設定
  "system", // 連携
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  logic: "ロジック",
  appearance: "見た目",
  interaction: "操作・遷移",
  motion: "動き",
  data: "データ",
  contract: "契約",
  config: "設定",
  system: "連携",
};

// 合格ライン: 変更の種類 → 使ってよい確かめ方(下限以上の集合)
export type Passline = Record<ChangeKind, CheckKind[]>;

// 見えないこと台帳の1行: この確かめ方では、このキーワードを含む動作は機械では確認できない
export interface CannotSeeEntry {
  checks: CheckKind[];
  keywords: string[];
  reason: string;
  instead: string;
}

// 動作一覧の1行: 動くと言っている動作(文)+ 変更の種類 + 使う確かめ方(確かめ計画)。
// change_kind が無いのは 2b 以前の旧形式(judge は 確認できず を返す)
export interface BehaviorEntry {
  behavior: string;
  change_kind?: ChangeKind;
  check: CheckKind;
}

// 動作ごとの判定(judge の出力の1行)
export interface BehaviorVerdict {
  index: number; // 1始まり(動作一覧の番号)
  verdict: Verdict;
  reason?: string;
}

// 判定結果: judge が報告レコードに保存する。証拠の集合が変わったら無効(削除される)
export interface Judgment {
  verdict: "passed" | "failed" | "unconfirmed";
  behaviors: BehaviorVerdict[];
  reasons: string[]; // 報告レベルの理由(ビルド混在・同一ソース不明 等)
  sourceSha: string | null; // submit が HEAD と照合する有効なソース(機械検証の到達点に差分確認の連鎖を適用した先)。dirty 検証は null
  verifiedSha?: string | null; // 機械が検証したソース(差分確認が無ければ sourceSha と同じ)。旧形式の記録には無い
  judgedAt: string;
}

// 差分確認: 検証したソースの後に積まれたコミットの差分を人間が自分の目で見て、
// 「判定は引き続き有効」と引き受ける記録。人間だけの操作(confirm / forget と同じ信頼層 —
// エージェントの語彙(MCP)には入れない)。
// 人間の強い権限は「照合を飛ばす」形にしない: submit の三点照合(sourceSha = HEAD = PR 先頭)は
// そのままに、judge が差分確認の連鎖で sourceSha を先へ進める — 提出済み(検証されたソースの提出)の意味を守る。
// 対象は fromSha が toSha の祖先である差分だけ(rebase・巻き戻しは取り直し)
export const DELTA_CONFIRM_LABEL = "差分確認";

export interface DeltaConfirmation {
  fromSha: string; // 引き受け元(機械が検証したソース、または前の差分確認の到達点)
  toSha: string; // 引き受け先(人間が差分を見て有効と判断したソース)
  note: string; // 差分の何を見てどう判断したか(記録の顔。必須)
  confirmedAt: string;
}

// 外に出す行為の境界線(2026-07 の再定義。人間の設計判断 — 事故由来ではなく、
// 「下書きPR 運用 + デフォルトブランチ保護を前提に、feature ブランチへの push のリスクは極小」という判断):
// - 共有(share): feature ブランチへの push・下書きPR(draft PR)の作成。可逆なのでエージェントの自由領域
// - 提出(submit): 検証された報告の下書きPR をレビュー可能にする(ドラフト解除)。ゲートだけの遷移
// - 取り込み(merge): 不可逆の採用。人間だけの操作 — エージェントの語彙に入れない(掃除 forget と同格)

// 提出の記録: submit が報告に保存する(FSM の終着)
export interface Submission {
  sha: string;
  branch: string;
  remote: string;
  prNumber?: number; // レビュー可能にした PR。旧形式(提出 = push)の記録には無い
  prUrl?: string;
  readiedAt?: string; // ドラフト解除の時刻
  pushedAt?: string; // 旧形式(提出 = push)の記録のみ
}

// 完了報告: エージェントの「できました」の型。動作一覧はオープン時に固定(変えたいなら別の作業名で開く)
export interface Report {
  reportId: string; // repoKey + 作業名から計算(べき等)
  title: string; // 作業名(日本語の日常語)
  branch?: string; // 作業ブランチ(オープン時に記録)。人間の動きは非同期 — 公式の遷移(差分確認・提出)は
  // ローカルのチェックアウト状態でなくこれを基準に動く。旧報告には無い(べき等な再オープンで補完される)
  behaviors: BehaviorEntry[]; // 並び順が番号(1始まり)。空の報告は作れない(A3)
  state: ReportState;
  evidence: { evidenceId: string; behaviorIndex: number }[];
  buildIds: string[]; // 紐づいた証拠の由来ビルド(重複なし)
  openedAt: string;
  judgment?: Judgment;
  deltaConfirms?: DeltaConfirmation[]; // 差分確認の記録(人間だけの操作)。判定はこの連鎖で sourceSha を先へ進める
  submission?: Submission;
}

// 全ツール共通の応答。rejected は reason(何がダメか)+ fix(どうすれば通るか)を必ず持つ。
// note: べき等な再呼び出しだったこと等、状態には残らないがエージェントが知るべき事実を伝える
export type Reply<S> =
  | { status: "ok"; state: S; note?: string; nextSteps: string[] }
  | { status: "rejected"; reason: string; fix: string; nextSteps: string[] };
