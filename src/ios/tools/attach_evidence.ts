import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { buildIdOf, shortBuildId } from "../build_id.js";
import { installedAppPath } from "../simulator.js";
import type { Build, Evidence, EvidenceKind, Reply, Report } from "../words.js";

export interface AttachEvidenceArgs {
  worksitePath: string;
  buildId: string;
  kind: EvidenceKind;
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
    report = readJson<Report>(join(gateDir, "reports", `${args.reportId}.json`));
    if (report === null) {
      return reject(`報告 ${args.reportId} が未オープン`, "先に open_report で報告を開いてください");
    }
    const index = args.behaviorIndex!;
    if (!Number.isInteger(index) || index < 1 || index > report.behaviors.length) {
      return reject(
        `動作の番号 ${index} が範囲外(この報告の動作一覧は 1〜${report.behaviors.length})`,
        "open_report の応答にある動作一覧の番号を使ってください",
      );
    }
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

// 受理済みの証拠を報告の動作に紐づける。同じ紐づけはべき等。
// 最初の証拠で状態を 下書き → 証拠あり に移す(FSM の移動はゲートだけが行う)
function linkToReport(
  gateDir: string,
  report: Report,
  behaviorIndex: number,
  evidenceId: string,
  buildId: string,
): string {
  const already = report.evidence.some((e) => e.evidenceId === evidenceId && e.behaviorIndex === behaviorIndex);
  if (already) {
    return `。報告「${report.title}」の動作${behaviorIndex}には既に紐づいている`;
  }
  report.evidence.push({ evidenceId, behaviorIndex });
  if (!report.buildIds.includes(buildId)) report.buildIds.push(buildId);
  const moved = report.state === "draft";
  if (moved) report.state = "evidenced";
  writeJson(join(gateDir, "reports", `${report.reportId}.json`), report);
  if (moved) {
    appendEvent(gateDir, { tool: "report_state", result: "ok", reportId: report.reportId, state: "evidenced" });
  }
  return `。報告「${report.title}」の動作${behaviorIndex}に紐づけた${moved ? "(状態: 下書き → 証拠あり)" : ""}`;
}
