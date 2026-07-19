// 対訳表(life repo: os/write/ios-domain-model.md 付録)と 1:1。表にない語は使わない。

export type Verdict = "ok" | "ng" | "unconfirmed";

export type EvidenceKind = "screenshot" | "ui_snapshot" | "video";

// ビルド: 検証対象の成果物。buildId は成果物の中身から計算する(git の commit ID と同じ仕組み)
// 記録は最初の登録時の事実で固定される(不変)。再登録時は応答の alreadyRegistered で既登録を明示する
export interface Build {
  buildId: string; // 表示・参照用の短縮形(先頭12文字)
  buildIdFull: string; // 照合はこちらで行う
  appPath: string;
  gitSha: string | null;
  dirty: boolean;
  scheme?: string;
  configuration?: string;
  registeredAt: string;
}

// 証拠: 1件の観測記録。出所(どのビルドを見たか)を持つ
export interface Evidence {
  evidenceId: string; // buildIdFull + kind + 観測ファイルの中身から決まる(べき等)
  buildId: string;
  kind: EvidenceKind;
  sourceFile: string; // 観測ファイルの元の場所
  storedFile: string; // 不変コピーの場所
  simulatorUdid: string;
  bundleId: string;
  note?: string;
  attachedAt: string;
}

// 完了報告の状態(ドメインモデル §3.2)。2a では 下書き/証拠あり まで。合格系は 2b で追加
export type ReportState = "draft" | "evidenced";

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
  human_check: "人間確認",
};

// 動作一覧の1行: 動くと言っている動作(文)+ 使う確かめ方(確かめ計画)
export interface BehaviorEntry {
  behavior: string;
  check: CheckKind;
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
}

// 全ツール共通の応答。rejected は reason(何がダメか)+ fix(どうすれば通るか)を必ず持つ。
// note: べき等な再呼び出しだったこと等、状態には残らないがエージェントが知るべき事実を伝える
export type Reply<S> =
  | { status: "ok"; state: S; note?: string; nextSteps: string[] }
  | { status: "rejected"; reason: string; fix: string; nextSteps: string[] };
