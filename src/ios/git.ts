import { execFileSync } from "node:child_process";

export function gitSha(worksitePath: string): string | null {
  try {
    return execFileSync("git", ["-C", worksitePath, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null; // コミットが1つもないリポジトリ。null として明示記録する(隠さない)
  }
}

export function gitDirty(worksitePath: string): boolean {
  const out = execFileSync("git", ["-C", worksitePath, "status", "--porcelain"], { encoding: "utf8" });
  return out.trim().length > 0;
}
