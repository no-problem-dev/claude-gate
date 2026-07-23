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

// 完了報告の状態マシン(遷移の宣言)。実装は report_link.ts(証拠の紐づけ)と judge / submit が担う —
// ここは言語としての宣言で、ガイドの状態マシン図はこれをそのまま描く(図だけの情報を作らない)。
// 提出済み(submitted)から出る遷移は無い(終着・不変)。ずれ・取り込み待ちは状態ではなく導出(DOMAIN_RELATIONS 側)
export interface ReportTransition {
  from: ReportState;
  to: ReportState;
  label: string; // 遷移を起こすできごと(日本語の文)
}

export const REPORT_TRANSITIONS: ReportTransition[] = [
  { from: "draft", to: "evidenced", label: "証拠を受理" },
  { from: "evidenced", to: "passed", label: "判定 — 全動作 OK" },
  { from: "evidenced", to: "failed", label: "判定 — NG あり" },
  { from: "evidenced", to: "unconfirmed", label: "判定 — 確認できず" },
  { from: "failed", to: "evidenced", label: "直して証拠を集め直す" },
  { from: "unconfirmed", to: "evidenced", label: "人間確認(証拠になる)" },
  { from: "passed", to: "evidenced", label: "証拠が増えて判定は無効" },
  { from: "passed", to: "submitted", label: "提出 — 記録だけの遷移" },
];

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
  sourceSha: string | null; // 有効な検証済みソース(機械検証の到達点に差分確認の連鎖を適用した先)。提出の記録に転記される。dirty 検証は null
  verifiedSha?: string | null; // 機械が検証したソース(差分確認が無ければ sourceSha と同じ)。旧形式の記録には無い
  judgedAt: string;
}

// 差分確認: 検証したソースの後に積まれたコミットの差分を人間が自分の目で見て、
// 「判定は引き続き有効」と引き受ける記録。人間だけの操作(confirm / forget と同じ信頼層 —
// エージェントの語彙(MCP)には入れない)。
// 人間の強い権限は「照合を飛ばす」形にしない: judge が差分確認の連鎖で sourceSha を先へ進め、
// 提出の記録が指す「検証されたソース」を最新に保つ — 提出済みの意味を守る。
// 対象は fromSha が toSha の祖先である差分だけ(rebase・巻き戻しは取り直し)
export const DELTA_CONFIRM_LABEL = "差分確認";

export interface DeltaConfirmation {
  fromSha: string; // 引き受け元(機械が検証したソース、または前の差分確認の到達点)
  toSha: string; // 引き受け先(人間が差分を見て有効と判断したソース)
  note: string; // 差分の何を見てどう判断したか(記録の顔。必須)
  confirmedAt: string;
}

// 外に出す行為の境界線(2026-07 再設計: 抽象=提出の記録 / 具体=消費者のガード、を分離する):
// - 共有(share): feature ブランチへの push・下書きPR(draft PR)の作成。可逆なのでエージェントの自由領域
// - 提出(submit): 検証と人間確認が終わった報告を「検証したソース(sourceSha)を受け入れた」と記録する
//   状態遷移。**git や gh のコマンドは実行しない**(ゲートは世界を読むが変えない)。FSM の終着
// - 取り込みに向かう操作(レビュー可能化 gh pr ready・デフォルトブランチへの push・merge):
//   提出という状態に依存する消費者(PreToolUse hook・ブランチ保護・人間)がガードする。
//   hook は「ブランチ先端の sha に一致する提出済みの報告があるか」をデーモンに照会し、
//   一致すればエージェント自身の gh pr ready を通す。merge とデフォルトブランチ push は
//   エージェントには常に遮断(人間は自由 — main 直運用では人間が提出の記録を確かめて push する)

// 取り込みの状態(導出。保存しない): 提出の記録の sha が origin のデフォルトブランチの祖先か
export const ENTERED_DEFAULT_BRANCH_LABEL = "デフォルトブランチに入った";
export const AWAITING_ADOPTION_LABEL = "取り込み待ち";

// 提出の記録: submit が報告に保存する(FSM の終着)。記録だけであり、push・レビュー可能化はしない。
// readiedAt / pushedAt は旧記録(提出が世界への実行を含んでいた頃)の時刻 —
// 読み取りモデル(kernel/api.ts)が recordedAt に正規化するためだけに型に残す
export interface Submission {
  sha: string; // 受け入れた検証済みソース(judgment.sourceSha の転記)
  branch?: string; // 報告の作業ブランチ(記録があるもののみ)
  recordedAt?: string; // 提出を記録した時刻
  via?: "dashboard"; // 入口(省略 = MCP / CLI)。監査と同じく経路を残す
  readiedAt?: string; // 旧記録の時刻(正規化用)
  pushedAt?: string; // 旧記録の時刻(正規化用)
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

// ─── ドメインモデルの1枚グラフ(モデル全体図)───
// 概念の台帳と、概念間の関係。語彙と同格の一級市民 — ガイドのモデル全体図はこの宣言の
// レンダリングにすぎない(図だけの情報を作らない)。
// 関係を型フィールドから自動抽出しないのは意図: このモデルの中心は型に現れない関係
// (導出・生成・人間だけの操作)だから。宣言が定義であり、概念の改名・削除は typecheck が検知する。

export type ConceptCategory = "actor" | "record" | "vocabulary" | "derived" | "operation" | "world";

export const CONCEPT_CATEGORY_LABEL: Record<ConceptCategory, string> = {
  actor: "役割",
  record: "記録(不変)",
  vocabulary: "語彙(分類・値)",
  derived: "導出(保存しない)",
  operation: "操作",
  world: "世界(git・GitHub)",
};

export interface Concept {
  ja: string; // 正式名(日本語の日常語)
  en: string; // 英語表記(人間向けの併記。機械の識別子はキー)
  category: ConceptCategory;
}

export const CONCEPTS = {
  // 役割
  agent: { ja: "エージェント", en: "agent", category: "actor" },
  gate: { ja: "ゲート", en: "gate", category: "actor" },
  human: { ja: "人間", en: "human", category: "actor" },
  verifier: { ja: "検証器", en: "verifier", category: "actor" },
  // 記録(不変)
  repository: { ja: "リポジトリ", en: "repository", category: "record" },
  report: { ja: "完了報告", en: "report", category: "record" },
  behavior: { ja: "動作", en: "behavior", category: "record" },
  build: { ja: "ビルド", en: "build", category: "record" },
  evidence: { ja: "証拠", en: "evidence", category: "record" },
  judgment: { ja: "判定結果", en: "judgment", category: "record" },
  submission: { ja: "提出の記録", en: "submission", category: "record" },
  confirm_delta: { ja: "差分確認", en: "confirm_delta", category: "record" },
  event: { ja: "できごと", en: "event", category: "record" },
  // 語彙(分類・値)
  build_id: { ja: "ビルドID", en: "build_id", category: "vocabulary" },
  source: { ja: "出所", en: "source", category: "vocabulary" },
  verdict: { ja: "判定", en: "verdict", category: "vocabulary" },
  change_kind: { ja: "変更の種類", en: "change_kind", category: "vocabulary" },
  check: { ja: "確かめ方", en: "check", category: "vocabulary" },
  passline: { ja: "合格ライン", en: "passline", category: "vocabulary" },
  check_run: { ja: "確かめの記録", en: "check_run", category: "vocabulary" },
  human_check: { ja: "人間確認", en: "human_check", category: "vocabulary" },
  cannot_see: { ja: "見えないこと台帳", en: "cannot_see registry", category: "vocabulary" },
  dirty: { ja: "未コミット変更あり", en: "dirty", category: "vocabulary" },
  // 導出(保存しない)
  attention: { ja: "注意", en: "attention", category: "derived" },
  report_group: { ja: "報告のグループ", en: "report group", category: "derived" },
  drift: { ja: "ずれ", en: "drift", category: "derived" },
  awaiting_adoption: { ja: "取り込み待ち", en: "awaiting adoption", category: "derived" },
  entered_default_branch: { ja: "デフォルトブランチに入った", en: "entered default branch", category: "derived" },
  // 操作
  submit: { ja: "提出", en: "submit", category: "operation" },
  share: { ja: "共有", en: "share", category: "operation" },
  pr_ready: { ja: "レビュー可能化", en: "gh pr ready", category: "operation" },
  merge: { ja: "取り込み", en: "merge", category: "operation" },
  // 世界(git・GitHub)
  branch: { ja: "作業ブランチ", en: "branch", category: "world" },
  draft_pr: { ja: "下書きPR", en: "draft PR", category: "world" },
  worksite: { ja: "作業場", en: "worksite", category: "world" },
} as const satisfies Record<string, Concept>;

export type ConceptId = keyof typeof CONCEPTS;

// 関係の種類。読み方の文型: 持つ/参照する/作る =「AはBを◯◯」、
// derives_from =「AはBから導出される」、is_a =「AはBの一種」
export type RelationKind = "has" | "refers" | "makes" | "derives_from" | "is_a";

export const RELATION_KIND_LABEL: Record<RelationKind, string> = {
  has: "持つ",
  refers: "参照する",
  makes: "作る",
  derives_from: "から導出される",
  is_a: "の一種",
};

export interface DomainRelation {
  from: ConceptId;
  to: ConceptId;
  kind: RelationKind;
  label?: string; // 図のエッジに出す個別の説明(無い関係は kind の読みで足りる)
}

export const DOMAIN_RELATIONS: DomainRelation[] = [
  // 包含: リポジトリ ⊃ {完了報告, ビルド, 証拠, できごと}
  { from: "repository", to: "report", kind: "has" },
  { from: "repository", to: "build", kind: "has" },
  { from: "repository", to: "evidence", kind: "has" },
  { from: "repository", to: "event", kind: "has" },
  // 完了報告の中身。参照は 報告 → 証拠 → ビルド の片方向
  { from: "report", to: "behavior", kind: "has", label: "動作一覧(オープン時に固定)" },
  { from: "report", to: "evidence", kind: "refers", label: "動作ごとに紐づける" },
  { from: "evidence", to: "build", kind: "refers", label: "出所(どのビルドから取れたか)" },
  { from: "behavior", to: "change_kind", kind: "refers", label: "何を変えたか" },
  { from: "behavior", to: "check", kind: "refers", label: "確かめ計画として宣言" },
  { from: "build_id", to: "build", kind: "derives_from", label: "中身から計算(偽れない)" },
  { from: "report", to: "branch", kind: "refers", label: "帰属先(オープン時に記録)" },
  // 判定: 決定論の pure function。証拠の集合が変われば無効
  { from: "report", to: "judgment", kind: "has", label: "証拠が変われば無効" },
  { from: "gate", to: "judgment", kind: "makes", label: "決定論で判定" },
  { from: "judgment", to: "verdict", kind: "has", label: "動作ごとに" },
  { from: "judgment", to: "passline", kind: "refers", label: "照合する" },
  { from: "judgment", to: "cannot_see", kind: "refers", label: "照合する" },
  { from: "passline", to: "change_kind", kind: "refers", label: "変更の種類ごとに" },
  { from: "passline", to: "check", kind: "refers", label: "使ってよい下限を列挙" },
  { from: "cannot_see", to: "check", kind: "refers", label: "見えない確かめ方" },
  { from: "cannot_see", to: "verifier", kind: "refers", label: "見えないことがある" },
  // 役割: 実行は自由、採用は厳格
  { from: "agent", to: "report", kind: "makes", label: "開く" },
  { from: "agent", to: "build", kind: "makes", label: "自由に作る" },
  { from: "verifier", to: "evidence", kind: "makes", label: "観測を取る" },
  { from: "gate", to: "evidence", kind: "makes", label: "出所を照合して受理" },
  { from: "gate", to: "check_run", kind: "makes", label: "自分でコマンドを実行" },
  { from: "check_run", to: "evidence", kind: "is_a" },
  // 人間の権限: 照合を飛ばす形ではなく、機械に見えない判断を記録として供給する形
  { from: "human", to: "human_check", kind: "makes", label: "人間だけが作れる" },
  { from: "human_check", to: "evidence", kind: "is_a" },
  { from: "human", to: "confirm_delta", kind: "makes", label: "差分を見て引き受ける" },
  { from: "report", to: "confirm_delta", kind: "has", label: "連鎖の記録" },
  { from: "confirm_delta", to: "judgment", kind: "refers", label: "sourceSha を先へ進める" },
  // 提出と取り込み: 抽象(記録)と具体(ガード)の分離
  { from: "submit", to: "submission", kind: "makes", label: "記録だけの状態遷移" },
  { from: "report", to: "submission", kind: "has", label: "終着" },
  { from: "submission", to: "judgment", kind: "refers", label: "sourceSha を転記" },
  { from: "pr_ready", to: "submission", kind: "refers", label: "ブランチ先端と一致で hook が通す" },
  { from: "human", to: "merge", kind: "makes", label: "人間だけの操作" },
  { from: "merge", to: "submission", kind: "refers", label: "記録を確かめて取り込む" },
  { from: "agent", to: "share", kind: "makes", label: "可逆・自由領域" },
  { from: "share", to: "draft_pr", kind: "makes", label: "下書きPRを作る" },
  { from: "share", to: "branch", kind: "refers", label: "feature ブランチへ push" },
  // できごと: オブジェクトに従属する監査記録
  { from: "event", to: "report", kind: "refers" },
  { from: "event", to: "build", kind: "refers" },
  { from: "event", to: "evidence", kind: "refers" },
  // 導出: 記録は不変、注意は毎回計算する
  { from: "attention", to: "event", kind: "derives_from", label: "未解決の拒否を毎回計算" },
  { from: "report_group", to: "report", kind: "derives_from", label: "状態から「誰の番か」" },
  { from: "drift", to: "judgment", kind: "derives_from", label: "検証したソースと" },
  { from: "drift", to: "branch", kind: "derives_from", label: "ブランチ先端の比較" },
  { from: "awaiting_adoption", to: "submission", kind: "derives_from", label: "sha が入ったか世界に聞く" },
  { from: "entered_default_branch", to: "submission", kind: "derives_from", label: "終着の静けさ" },
];
