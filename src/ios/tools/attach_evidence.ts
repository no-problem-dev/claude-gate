import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { buildIdOf, shortBuildId } from "../build_id.js";
import { SWIFT_SELF_REPORT_SNIPPET, parseBuildUuid } from "../macho_uuid.js";
import { linkToReport, readReport, validateLink } from "../report_link.js";
import { installedAppPath } from "../simulator.js";
import type { Build, Evidence, Reply, Report } from "../words.js";

export interface AttachEvidenceArgs {
  worksitePath: string;
  buildId: string;
  // check_run はゲート自身が作る(run_check)。device_report は実機で走ったアプリのセルフレポート
  kind: "screenshot" | "ui_snapshot" | "video" | "device_report";
  file: string;
  simulatorUdid?: string; // シミュレータ観測(screenshot / ui_snapshot / video)で必須
  deviceUdid?: string; // 実機レポート(device_report)で必須
  bundleId: string;
  note?: string;
  reportId?: string; // 報告への紐づけ(behaviorIndex と両方指定 or 両方省略)
  behaviorIndex?: number; // open_report が返す 1 始まりの番号
}

export interface AttachEvidenceDeps {
  installedAppPath: (simulatorUdid: string, bundleId: string) => string;
}

const defaultDeps: AttachEvidenceDeps = { installedAppPath };

export function attachEvidence(args: AttachEvidenceArgs, deps: AttachEvidenceDeps = defaultDeps): Reply<Evidence> {
  const gateDir = repoDirOf(args.worksitePath);
  const reject = (reason: string, fix: string): Reply<Evidence> => {
    // 報告に関する拒否は報告に紐づけて記録する(注意の導出が「同じ報告のその後の成功」で解消を判定できるように)
    appendEvent(gateDir, {
      tool: "attach_evidence",
      result: "rejected",
      buildId: args.buildId,
      reportId: args.reportId,
      reason,
    });
    return { status: "rejected", reason, fix, nextSteps: ["register_build", "attach_evidence"] };
  };

  // 報告への紐づけは、出所照合より先に宣言の正しさを確かめる(不正な紐づけ先で受理しない)
  const wantsLink = args.reportId !== undefined || args.behaviorIndex !== undefined;
  if (wantsLink && (args.reportId === undefined || args.behaviorIndex === undefined)) {
    return reject(
      "reportId と behaviorIndex は両方指定するか、両方省略する",
      "報告に紐づけるなら open_report が返した reportId と動作の番号(1始まり)をセットで渡してください",
    );
  }
  let report: Report | null = null;
  if (wantsLink) {
    report = readReport(gateDir, args.reportId!);
    const invalid = validateLink(report, args.reportId!, args.behaviorIndex!);
    if (invalid !== null) return reject(invalid.reason, invalid.fix);
  }

  const build = readJson<Build>(join(gateDir, "builds", `${args.buildId}.json`));
  if (build === null) {
    return reject(
      `ビルド ${args.buildId} が未登録`,
      "先に register_build でビルドを登録してください",
    );
  }

  if (!existsSync(args.file)) {
    return reject(`観測ファイルが存在しない: ${args.file}`, "スクショ・録画・レポートの保存先パスを確認してください");
  }

  // 出所照合: 種類によって照合の仕方が変わる。
  // シミュレータ観測はシミュレータ内の実物と .app の中身ハッシュを照合する(実物が取れる)。
  // 実機レポートは実機から .app を取れないので、Mach-O UUID(セルフレポートの buildUUID)で照合する
  if (args.kind === "device_report") {
    const invalid = verifyDeviceReport(args, build);
    if (invalid !== null) return reject(invalid.reason, invalid.fix);
  } else {
    if (args.simulatorUdid === undefined) {
      return reject(
        `${args.kind} の証拠には simulatorUdid が必要`,
        "観測したシミュレータの UDID を渡してください(実機のセルフレポートなら kind: device_report + deviceUdid)",
      );
    }
    let installed: string;
    try {
      installed = deps.installedAppPath(args.simulatorUdid, args.bundleId);
    } catch (error) {
      return reject(
        `シミュレータ内のアプリの場所を取得できない(simctl get_app_container 失敗): ${String(error)}`,
        `シミュレータ ${args.simulatorUdid} に ${args.bundleId} がインストールされているか確認してください`,
      );
    }
    const installedFull = buildIdOf(installed);
    if (installedFull !== build.buildIdFull) {
      return reject(
        `シミュレータに入っているのは登録したビルドと別物(シミュレータ内: ${shortBuildId(installedFull)} / 登録: ${build.buildId})`,
        "登録したビルドを install し直すか、いま入っているビルドを register_build してから撮り直してください",
      );
    }
  }

  const fileSha = createHash("sha256").update(readFileSync(args.file)).digest("hex");
  const evidenceId = shortBuildId(
    createHash("sha256").update(`${build.buildIdFull}\0${args.kind}\0${fileSha}`).digest("hex"),
  );
  const recordPath = join(gateDir, "evidence", `${evidenceId}.json`);

  const existing = readJson<Evidence>(recordPath);
  if (existing !== null) {
    const linkNote = report !== null ? linkToReport(gateDir, report, args.behaviorIndex!, evidenceId, build.buildId) : "";
    appendEvent(gateDir, {
      tool: "attach_evidence",
      result: "ok",
      evidenceId,
      alreadyAttached: true,
      ...(report !== null && { reportId: report.reportId, behaviorIndex: args.behaviorIndex }),
    });
    return {
      status: "ok",
      state: existing,
      note: `既添付の証拠(添付: ${existing.attachedAt})。同じビルド・同じ観測ファイルは1件に収束する${linkNote}`,
      nextSteps: ["attach_evidence"],
    };
  }

  const storedFile = join(gateDir, "evidence", `${evidenceId}${extname(args.file)}`);
  copyFileSync(args.file, storedFile); // 不変コピー: 元ファイルが後で上書きされても証拠は変わらない

  const evidence: Evidence = {
    evidenceId,
    buildId: build.buildId,
    kind: args.kind,
    sourceFile: args.file,
    storedFile,
    bundleId: args.bundleId,
    note: args.note,
    attachedAt: new Date().toISOString(),
    ...(args.simulatorUdid !== undefined && { simulatorUdid: args.simulatorUdid }),
    ...(args.deviceUdid !== undefined && { deviceUdid: args.deviceUdid }),
  };
  writeJson(recordPath, evidence);
  const linkNote = report !== null ? linkToReport(gateDir, report, args.behaviorIndex!, evidenceId, build.buildId) : "";
  appendEvent(gateDir, {
    tool: "attach_evidence",
    result: "ok",
    evidenceId,
    buildId: build.buildId,
    ...(report !== null && { reportId: report.reportId, behaviorIndex: args.behaviorIndex }),
  });
  return {
    status: "ok",
    state: evidence,
    ...(linkNote !== "" && { note: linkNote.replace(/^。/, "") }),
    nextSteps: ["attach_evidence"],
  };
}

// 実機レポートの出所照合: レポート本文の buildUUID を登録済みビルドの Mach-O UUID 集合と照合する。
// 問題があれば拒否理由(reason)+ 直し方(fix)を返す。null なら照合 OK
function verifyDeviceReport(args: AttachEvidenceArgs, build: Build): { reason: string; fix: string } | null {
  if (args.deviceUdid === undefined) {
    return {
      reason: "device_report の証拠には deviceUdid が必要",
      fix: "レポートを回収した実機の UDID を渡してください(シミュレータ観測なら kind: screenshot 等 + simulatorUdid)",
    };
  }
  const reported = parseBuildUuid(readFileSync(args.file, "utf8"));
  if (reported === null) {
    return {
      reason: "セルフレポートに buildUUID= 行が無い(実機で走ったビルドを特定できない)",
      fix: `アプリが起動時に自分の Mach-O UUID を出力する規約にしてください(下のコードを写す)。出力した console を回収して file に渡す:\n\n${SWIFT_SELF_REPORT_SNIPPET}`,
    };
  }
  const known = (build.machoUuids ?? []).map((u) => u.toUpperCase());
  if (known.length === 0) {
    return {
      reason: `登録ビルド ${build.buildId} に Mach-O UUID の記録が無い(この .app からは実行バイナリを読めなかった)`,
      fix: "実機に入れたのと同じ .app を register_build し直してください(実バイナリを含む成果物なら UUID が記録されます)",
    };
  }
  if (!known.includes(reported)) {
    return {
      reason: `実機で走ったのは登録したビルドと別物(レポート: ${reported} / 登録: ${known.join(", ")})`,
      fix: "実機に登録したビルドを install し直すか、いま実機に入っているビルドの .app を register_build してから回収し直してください",
    };
  }
  return null;
}
