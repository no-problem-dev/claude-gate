#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
        return;
      }
    } catch {
      // 起動待ち
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`claude-gate が ${port} で応答しない。${join(gateHome(), "logs")} を確認してください`);
}

async function doctor(): Promise<void> {
  console.log(`data:   ${gateHome()}`);
  console.log(`server: http://127.0.0.1:${port}/mcp`);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    console.log(`health: ${await res.text()}`);
  } catch (error) {
    console.log(`health: 接続できない(${String(error)})。claude-gate install で常駐させてください`);
    process.exitCode = 1;
  }
}

function help(): void {
  console.log(`claude-gate <command>

  serve    サーバをこのプロセスで起動する(開発用)
  install  launchd に常駐させる(べき等)
  doctor   稼働状態とデータの場所を表示する`);
}
