#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  default:
    help();
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
      "claude plugin install claude-gate@taniguchi-kyoichi を実行してください",
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
  doctor   稼働状態を点検する(デーモン/ダッシュボード/プラグイン)`);
}
