import type { CannotSeeEntry, Passline } from "./words.js";

// ゲート同梱のデフォルト(gate.yaml が無くても動く)。
// 各行は実際に起きた事故・実記録に由来する(推測で行を増やさない)

// 合格ライン: 変更の種類 → 使ってよい確かめ方(ios-task-loop.md §3 対応表の機械化)。
// gate.yaml の passline は「書いた種類だけ」この表を置き換える
// device_report(実機レポート)は実機 E2E の強い証拠。挙動・状態の変更(pixel でない種類)では
// 常に下限以上として使える。見た目・動きの合否は実機ログに写らないので appearance / motion には入れない
export const DEFAULT_PASSLINE: Passline = {
  logic: ["unit_test", "ui_test", "device_report"],
  appearance: ["screenshot", "interaction_log", "ui_test", "video"],
  // 操作の動作を静的スクショで覆う言い換えが実際に起きた(ドッグフード #12)ため screenshot は不可
  interaction: ["interaction_log", "ui_test", "video", "device_report"],
  motion: ["video", "human_check"],
  data: ["unit_test", "ui_test", "device_report"],
  contract: ["compile", "unit_test", "ui_test", "device_report"],
  config: ["launch_check", "interaction_log", "ui_test", "video", "device_report"],
  system: ["interaction_log", "ui_test", "video", "device_report", "human_check"],
};

// 見えないこと台帳: 記憶(reference_*)をデータ化し、判定時に機械参照する(A2 / A5)
export const BUNDLED_CANNOT_SEE: CannotSeeEntry[] = [
  {
    checks: ["screenshot", "interaction_log", "ui_test", "video", "launch_check"],
    // 「購入」単独は禁止: 買い物系アプリの一般語（例:「購入直後行の表示色」）に部分一致して
    // 課金と無関係な appearance 動作を確認できず化した実誤検知がある(stock-radar 2026-07-23)。
    // 課金文脈は複合語でだけ拾う
    keywords: ["課金", "アプリ内購入", "IAP", "サブスク", "ペイウォール", "買い切り", "StoreKit"],
    reason: ".storekit 設定は Xcode IDE Run でのみ有効。シミュレータの自動操作(simctl 経由)は実サンドボックスに落ち、課金フローの検証が成立しない",
    instead: "human_check(Xcode Run で人間が確認)",
  },
  {
    checks: ["interaction_log", "ui_test"],
    keywords: ["日本語入力", "日本語を入力"],
    reason: "type_text は日本語を入力できない",
    instead: "クリップボード経由の操作、または human_check",
  },
  {
    checks: ["screenshot", "interaction_log", "ui_test", "video", "launch_check"],
    keywords: ["プッシュ通知", "APNs", "リモート通知"],
    reason: "シミュレータは APNs デバイストークンを転送しないことがあり、実プッシュの検証が成立しない",
    instead: "実機 + human_check",
  },
];
