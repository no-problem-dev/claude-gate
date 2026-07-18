import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { buildIdOf, shortBuildId } from "../build_id.js";
import { installedAppPath } from "../simulator.js";
import type { Build, Evidence, EvidenceKind, Reply } from "../words.js";

export interface AttachEvidenceArgs {
  worksitePath: string;
  buildId: string;
  kind: EvidenceKind;
  file: string;
  simulatorUdid: string;
  bundleId: string;
  note?: string;
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
    appendEvent(gateDir, { tool: "attach_evidence", result: "ok", evidenceId, alreadyAttached: true });
    return {
      status: "ok",
      state: existing,
      note: `既添付の証拠(添付: ${existing.attachedAt})。同じビルド・同じ観測ファイルは1件に収束する`,
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
  appendEvent(gateDir, { tool: "attach_evidence", result: "ok", evidenceId, buildId: build.buildId });
  return { status: "ok", state: evidence, nextSteps: ["attach_evidence"] };
}
