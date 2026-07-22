#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { confirmBehavior, confirmDelta } from "./ios/confirm.js";
import { commitsBetween } from "./ios/git.js";
import { initGateYaml } from "./ios/gate_init.js";
import { forgetBuild, forgetEvidence, forgetRepo, forgetReport, resolveRepoKey } from "./kernel/forget.js";
import { gateHome } from "./kernel/store.js";

const port = Number(process.env.GATE_PORT ?? 7350);
const label = "com.taniguchi.claude-gate";
const serverPath = join(dirname(fileURLToPath(import.meta.url)), "kernel", "server.js");

const command = process.argv[2] ?? "help";
switch (command) {
  case "serve":
    await import("./kernel/server.js");
    break;
  case "install":
    await install();
    await waitForHealth();
    break;
  case "doctor":
    await doctor();
    break;
  case "init":
    init();
    break;
  case "confirm":
    confirm(process.argv.slice(3));
    break;
  case "confirm-delta":
    confirmDeltaCommand(process.argv.slice(3));
    break;
  case "forget":
    forget(process.argv.slice(3));
    break;
  default:
    help();
}

// 新規リポジトリへの導入(カレントディレクトリに gate.yaml の雛形を作る。既存は上書きしない)
function init(): void {
  const outcome = initGateYaml(process.cwd());
  if (outcome.status === "created") {
    console.log(`✓ gate.yaml を作成しました: ${outcome.path}`);
    console.log("  checks のスキーム名・コマンドをこのリポジトリに合わせて編集し、git に載せてください");
    console.log("  (全セクション任意。消せば同梱デフォルトで動きます)");
  } else {
    console.log(`○ gate.yaml は既にあります(上書きしません): ${outcome.path}`);
  }
}

// 掃除(人間の操作。エージェントには MCP ツールとして公開しない)
// 人間確認(人間の操作): 動作を自分の目で確かめた事実を証拠として記録し、自動で再判定する
function confirm(args: string[]): void {
  const [worksitePath, ...rest] = args;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i]?.startsWith("--") && rest[i + 1] !== undefined) flags.set(rest[i], rest[i + 1]);
  }
  const report = flags.get("--report");
  const behavior = Number(flags.get("--behavior"));
  const note = flags.get("--note");
  if (!worksitePath || report === undefined || !Number.isInteger(behavior) || note === undefined) {
    console.log('usage: claude-gate confirm <worksitePath> --report <作業名|reportId> --behavior <番号> --note "何を確認したか"');
    process.exitCode = 1;
    return;
  }
  const result = confirmBehavior({ worksitePath, report, behaviorIndex: behavior, note });
  if (result.status === "rejected") {
    console.log(`✗ ${result.reason}`);
    console.log(`  直し方: ${result.fix}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${result.note}`);
}

// 差分確認(人間の操作): 検証したソースの後に積まれた差分を見た上で、判定を toSha(省略 = HEAD)まで引き受ける
function confirmDeltaCommand(args: string[]): void {
  const [worksitePath, ...rest] = args;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i]?.startsWith("--") && rest[i + 1] !== undefined) flags.set(rest[i], rest[i + 1]);
  }
  const report = flags.get("--report");
  const note = flags.get("--note");
  const to = flags.get("--to");
  if (!worksitePath || report === undefined || note === undefined) {
    console.log(
      'usage: claude-gate confirm-delta <worksitePath> --report <作業名|reportId> --note "差分の何を見てどう判断したか" [--to <コミット>]',
    );
    process.exitCode = 1;
    return;
  }
  const result = confirmDelta({ worksitePath, report, toSha: to, note });
  if (result.status === "rejected") {
    console.log(`✗ ${result.reason}`);
    console.log(`  直し方: ${result.fix}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${result.note}`);
  const last = result.state.deltaConfirms?.at(-1);
  if (last !== undefined) {
    for (const commit of commitsBetween(worksitePath, last.fromSha, last.toSha)) {
      console.log(`  ${commit.sha.slice(0, 7)} ${commit.subject}`);
    }
  }
}

function forget(args: string[]): void {
  const [target, flag, id] = args;
  if (!target) {
    console.log("usage: claude-gate forget <repoKey|path> [--build <id> | --report <id> | --evidence <id>]");
    process.exitCode = 1;
    return;
  }
  const repoKey = resolveRepoKey(target);
  if (repoKey === null) {
    console.log(`✗ リポジトリが見つからない: ${target}(repoKey 12桁か、台帳に載っているパスを渡してください)`);
    process.exitCode = 1;
    return;
  }
  const outcome =
    flag === undefined
      ? forgetRepo(repoKey)
      : flag === "--build" && id
        ? forgetBuild(repoKey, id)
        : flag === "--report" && id
          ? forgetReport(repoKey, id)
          : flag === "--evidence" && id
            ? forgetEvidence(repoKey, id)
            : null;
  if (outcome === null) {
    console.log(`✗ 不明なオプション: ${flag}(--build / --report / --evidence + ID)`);
    process.exitCode = 1;
    return;
  }
  const mark = outcome.status === "removed" ? "✓" : outcome.status === "already-gone" ? "○" : "✗";
  console.log(`${mark} ${outcome.detail}`);
  if (outcome.status === "refused") process.exitCode = 1;
}

// launchd に常駐させる(何度実行しても安全)
async function install(): Promise<void> {
  const logsDir = join(gateHome(), "logs");
  mkdirSync(logsDir, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${serverPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logsDir, "claude-gate.log")}</string>
  <key>StandardErrorPath</key><string>${join(logsDir, "claude-gate.error.log")}</string>
</dict>
</plist>
`;
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  writeFileSync(plistPath, plist);
  const uid = execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
  } catch {
    // 未登録なら bootout は失敗する。初回インストールの正常ケース
  }
  // bootout の反映完了前に bootstrap すると EIO で失敗するため、待って再試行する
  let lastError: unknown;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { stdio: "pipe" });
      console.log(`installed: ${plistPath}`);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        console.log(await res.text());
        console.log("claude-gate is running");
        console.log(`dashboard: http://127.0.0.1:${port}/`);
        return;
      }
    } catch {
      // 起動待ち
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`claude-gate が ${port} で応答しない。${join(gateHome(), "logs")} を確認してください`);
}

// マシン再起動後・調子が悪い時にこれ一発で全部の状態が分かる(直し方も出す)
async function doctor(): Promise<void> {
  let healthy = true;
  const check = (ok: boolean, label: string, detail: string, fix?: string) => {
    console.log(`${ok ? "✓" : "✗"} ${label}: ${detail}`);
    if (!ok) {
      healthy = false;
      if (fix) console.log(`    → ${fix}`);
    }
  };

  console.log(`data: ${gateHome()}`);

  const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  check(
    existsSync(plistPath),
    "launchd 登録",
    existsSync(plistPath) ? plistPath : "plist がない",
    "claude-gate install を実行してください",
  );

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    check(res.ok, "デーモン", await res.text());
  } catch (error) {
    check(false, "デーモン", `接続できない(${String(error)})`, "claude-gate install で常駐させてください");
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/overview`);
    const body = (await res.json()) as { repos: unknown[] };
    check(res.ok, "ダッシュボード", `http://127.0.0.1:${port}/ (リポジトリ ${body.repos.length} 件)`);
  } catch {
    check(false, "ダッシュボード", "API が応答しない", "npm run build 後に claude-gate install で再起動してください");
  }

  try {
    const list = execFileSync("claude", ["plugin", "list"], { encoding: "utf8" });
    check(
      list.includes("claude-gate@"),
      "Claude Code プラグイン",
      list.includes("claude-gate@") ? "導入済み(gate MCP + gate-loop スキル)" : "未導入",
      "claude plugin marketplace add <このリポジトリのパス> && claude plugin install claude-gate@claude-gate を実行してください",
    );
  } catch {
    check(false, "Claude Code プラグイン", "claude CLI が見つからない", "Claude Code をインストールしてください");
  }

  if (!healthy) process.exitCode = 1;
}

function help(): void {
  console.log(`claude-gate <command>

  serve    サーバをこのプロセスで起動する(開発用)
  install  launchd に常駐させる(べき等)
  doctor   稼働状態を点検する(デーモン/ダッシュボード/プラグイン)
  init     カレントリポジトリに gate.yaml の雛形を作る(既存は上書きしない)
  confirm  人間確認(人間の操作): 動作を確かめた事実を証拠に記録し、自動で再判定
  confirm-delta  差分確認(人間の操作): 検証したソースの後に積まれた差分を見た上で
           判定を引き受け、sourceSha を先へ進める(submit の照合は変えない)
  forget   掃除(人間の操作): リポジトリの状態 / --build / --report / --evidence を削除
           参照されている記録は消せない。レコード単位の削除は監査ログに残る`);
}
