// 語彙の定義: 日本語の正式名と英語識別子の 1:1 対訳。ここにない語は実装に登場させない。

export type Verdict = "ok" | "ng" | "unconfirmed";

// 証拠の種類。check_run(確かめの記録)はゲート自身がコマンドを実行した結果(2b)。
// device_report(実機レポート)は実機で走ったアプリ自身のセルフレポート(console 出力等) —
// 実機からは .app を取り出せないので、出所照合はビルドの中身ハッシュではなく Mach-O UUID で行う
export type EvidenceKind = "screenshot" | "ui_snapshot" | "video" | "check_run" | "device_report";

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
  sourceSha: string | null; // 検証したソース。submit が HEAD と照合する。dirty 検証は null
  judgedAt: string;
}

// 提出の記録: submit が報告に保存する(FSM の終着)
export interface Submission {
  sha: string;
  branch: string;
  remote: string;
  pushedAt: string;
}

// 完了報告: エージェントの「できました」の型。動作一覧はオープン時に固定(変えたいなら別の作業名で開く)
export interface Report {
  reportId: string; // repoKey + 作業名から計算(べき等)
  title: string; // 作業名(日本語の日常語)
  behaviors: BehaviorEntry[]; // 並び順が番号(1始まり)。空の報告は作れない(A3)
  state: ReportState;
  evidence: { evidenceId: string; behaviorIndex: number }[];
  buildIds: string[]; // 紐づいた証拠の由来ビルド(重複なし)
  openedAt: string;
  judgment?: Judgment;
  submission?: Submission;
}

// 全ツール共通の応答。rejected は reason(何がダメか)+ fix(どうすれば通るか)を必ず持つ。
// note: べき等な再呼び出しだったこと等、状態には残らないがエージェントが知るべき事実を伝える
export type Reply<S> =
  | { status: "ok"; state: S; note?: string; nextSteps: string[] }
  | { status: "rejected"; reason: string; fix: string; nextSteps: string[] };
