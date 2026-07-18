// 対訳表(life repo: os/write/ios-domain-model.md 付録)と 1:1。表にない語は使わない。

export type Verdict = "ok" | "ng" | "unconfirmed";

export type EvidenceKind = "screenshot" | "ui_snapshot" | "video";

// ビルド: 検証対象の成果物。buildId は成果物の中身から計算する(git の commit ID と同じ仕組み)
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

// 全ツール共通の応答。rejected は reason(何がダメか)+ fix(どうすれば通るか)を必ず持つ
export type Reply<S> =
  | { status: "ok"; state: S; nextSteps: string[] }
  | { status: "rejected"; reason: string; fix: string; nextSteps: string[] };
