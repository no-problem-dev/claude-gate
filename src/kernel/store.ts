import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ローカルデータは普通のアプリとして ~/.claude-gate に置く(テストは GATE_HOME で差し替える)
export function gateHome(): string {
  return process.env.GATE_HOME ?? join(homedir(), ".claude-gate");
}

// リポジトリの同定: git 共有ディレクトリの実パス。
// 全 worktree から同じ値に解決され、worktree を削除しても状態が残る。
export function repoDirOf(worksitePath: string): string {
  const common = execFileSync("git", ["-C", worksitePath, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  const commonAbs = realpathSync(resolve(worksitePath, common));
  const repoKey = createHash("sha256").update(commonAbs).digest("hex").slice(0, 12);
  const dir = join(gateHome(), "repos", repoKey);
  mkdirSync(join(dir, "builds"), { recursive: true });
  mkdirSync(join(dir, "evidence"), { recursive: true });
  registerRepo(repoKey, commonAbs);
  return dir;
}

// ダッシュボード用の台帳: どのキーがどのリポジトリか
function registerRepo(repoKey: string, commonDir: string): void {
  const path = join(gateHome(), "repos.json");
  const registry = readJson<Record<string, { commonDir: string; lastSeenAt: string }>>(path) ?? {};
  registry[repoKey] = { commonDir, lastSeenAt: new Date().toISOString() };
  writeJson(path, registry);
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
