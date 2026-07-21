import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { RUNNABLE_CHECKS, loadGateYaml } from "../gate_yaml.js";
import type { RunnableCheck } from "../gate_yaml.js";
import { gitDirty, gitSha } from "../git.js";
import { linkToReport, readReport, validateLink } from "../report_link.js";
import { shortBuildId } from "../build_id.js";
import type { Evidence, Reply, Report } from "../words.js";

// 確かめを実行する: エージェントが「テストを回した」と自己申告するのではなく、
// ゲート自身が gate.yaml に宣言されたコマンドを実行し、終了コードと出力を証拠にする(A3 の実行版)。
// コマンド自体の正しさはゲートは見ない — gate.yaml は git 管理なので人間レビューの領分

export interface RunCheckArgs {
  worksitePath: string;
  check: string;
  reportId?: string;
  behaviorIndex?: number;
}

export interface RunCheckDeps {
  runCommand: (command: string, cwd: string) => { exitCode: number | null; output: string; timedOut: boolean };
}

const TIMEOUT_MS = 10 * 60 * 1000;

const defaultDeps: RunCheckDeps = {
  runCommand: (command, cwd) => {
    const run = spawnSync("/bin/sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return {
      exitCode: run.status,
      output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
      timedOut,
    };
  },
};

export function runCheck(args: RunCheckArgs, deps: RunCheckDeps = defaultDeps): Reply<Evidence> {
  const gateDir = repoDirOf(args.worksitePath);
  const reject = (reason: string, fix: string): Reply<Evidence> => {
    // 報告に関する拒否は報告に紐づけて記録する(注意の導出が「同じ報告のその後の成功」で解消を判定できるように)
    appendEvent(gateDir, { tool: "run_check", result: "rejected", check: args.check, reportId: args.reportId, reason });
    return { status: "rejected", reason, fix, nextSteps: ["run_check"] };
  };

  if (!(RUNNABLE_CHECKS as readonly string[]).includes(args.check)) {
    return reject(
      `確かめ方「${args.check}」はコマンド実行できない(実行できるのは ${RUNNABLE_CHECKS.join(" / ")})`,
      "スクショ・操作記録・録画はシミュレータで観測して attach_evidence で証拠にしてください",
    );
  }
  const check = args.check as RunnableCheck;

  // 紐づけの宣言は実行より先に確かめる(10分走った後に紐づけ先が不正、を防ぐ)
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

  const yaml = loadGateYaml(args.worksitePath);
  if (yaml.error !== undefined) {
    return reject(yaml.error, "リポジトリの gate.yaml を直してください");
  }
  const command = yaml.config?.checks[check];
  if (command === undefined) {
    return reject(
      `gate.yaml に確かめ方「${check}」の実行コマンドが宣言されていない`,
      `リポジトリの gate.yaml に checks.${check} を宣言してください(例: checks: { unit_test: "swift test" })`,
    );
  }

  // 実行時のソース(gitSha / dirty)が check_run の出所になる
  const sha = gitSha(args.worksitePath);
  const dirty = gitDirty(args.worksitePath);
  const run = deps.runCommand(command, args.worksitePath);
  if (run.timedOut || run.exitCode === null) {
    return reject(
      `コマンドが完了しなかった(タイムアウト ${TIMEOUT_MS / 60000} 分): ${command}`,
      "コマンドを見直すか、対象を絞って実行時間を短くしてください",
    );
  }

  const outputSha = createHash("sha256").update(run.output).digest("hex");
  const evidenceId = shortBuildId(
    createHash("sha256")
      .update(`${check}\0${command}\0${sha ?? "no-commit"}\0${dirty}\0${run.exitCode}\0${outputSha}`)
      .digest("hex"),
  );
  const recordPath = join(gateDir, "evidence", `${evidenceId}.json`);

  const existing = readJson<Evidence>(recordPath);
  if (existing !== null) {
    const link = report !== null ? linkToReport(gateDir, report, args.behaviorIndex!, evidenceId, null) : null;
    appendEvent(gateDir, {
      tool: "run_check",
      result: "ok",
      evidenceId,
      check,
      exitCode: run.exitCode,
      alreadyAttached: true,
      ...(report !== null && { reportId: report.reportId, behaviorIndex: args.behaviorIndex }),
      ...(link?.reportState !== undefined && { reportState: link.reportState }),
      ...(link?.judgmentInvalidated === true && { judgmentInvalidated: true }),
    });
    return {
      status: "ok",
      state: existing,
      note: `同一ソース・同一結果の確かめは既に記録済み(${existing.attachedAt})${link?.note ?? ""}`,
      nextSteps: ["judge"],
    };
  }

  const storedFile = join(gateDir, "evidence", `${evidenceId}.log`);
  writeFileSync(storedFile, run.output);

  const evidence: Evidence = {
    evidenceId,
    kind: "check_run",
    storedFile,
    attachedAt: new Date().toISOString(),
    check,
    command,
    exitCode: run.exitCode,
    gitSha: sha,
    dirty,
  };
  writeJson(recordPath, evidence);
  const link = report !== null ? linkToReport(gateDir, report, args.behaviorIndex!, evidenceId, null) : null;
  appendEvent(gateDir, {
    tool: "run_check",
    result: "ok",
    evidenceId,
    check,
    exitCode: run.exitCode,
    ...(report !== null && { reportId: report.reportId, behaviorIndex: args.behaviorIndex }),
    ...(link?.reportState !== undefined && { reportState: link.reportState }),
    ...(link?.judgmentInvalidated === true && { judgmentInvalidated: true }),
  });
  return {
    status: "ok",
    state: evidence,
    note: `終了コード ${run.exitCode}${dirty ? "(未コミット変更ありのソースで実行)" : ""}${link?.note ?? ""}`,
    nextSteps: ["judge"],
  };
}
