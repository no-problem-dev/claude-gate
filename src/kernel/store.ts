import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// 状態は git 共有ディレクトリ配下に置く(全 worktree から同じ場所に解決され、worktree 削除に耐える)
export function gateDirOf(worksitePath: string): string {
  const common = execFileSync("git", ["-C", worksitePath, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  const dir = join(resolve(worksitePath, common), "gate");
  mkdirSync(join(dir, "builds"), { recursive: true });
  mkdirSync(join(dir, "evidence"), { recursive: true });
  return dir;
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
