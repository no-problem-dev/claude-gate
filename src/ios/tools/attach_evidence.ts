import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { buildIdOf, shortBuildId } from "../build_id.js";
import { linkToReport, readReport, validateLink } from "../report_link.js";
import { installedAppPath } from "../simulator.js";
import type { Build, Evidence, Reply, Report } from "../words.js";

export interface AttachEvidenceArgs {
  worksitePath: string;
  buildId: string;
  kind: "screenshot" | "ui_snapshot" | "video"; // check_run はゲート自身が作る(run_check)
  file: string;
  simulatorUdid: string;
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
    appendEvent(gateDir, { tool: "attach_evidence", result: "rejected", buildId: args.buildId, reason });
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
    return reject(`観測ファイルが存在しない: ${args.file}`, "スクショ・録画の保存先パスを確認してください");
  }

  // 出所照合: シミュレータ内の実物からビルドID を計算し直し、登録済みの ID と比べる
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
    simulatorUdid: args.simulatorUdid,
    bundleId: args.bundleId,
    note: args.note,
    attachedAt: new Date().toISOString(),
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
