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

export function gitBranch(worksitePath: string): string | null {
  try {
    return execFileSync("git", ["-C", worksitePath, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

// ブランチ先端(共有リポジトリの実体)。refs は全 worktree で共有されるので、
// worksitePath がどのチェックアウトでも同じ値になる — 公式の遷移はローカルの状態に依存しない
export function branchTip(worksitePath: string, branch: string): string | null {
  try {
    return execFileSync("git", ["-C", worksitePath, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

// 参照(短縮 sha・ブランチ名等)を完全な commit ID に解決する
export function resolveSha(worksitePath: string, ref: string): string | null {
  try {
    return execFileSync("git", ["-C", worksitePath, "rev-parse", "--verify", `${ref}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function isAncestor(worksitePath: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["-C", worksitePath, "merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// from..to のコミット一覧(新しい順)。差分確認で人間に見せる判断材料
export function commitsBetween(worksitePath: string, from: string, to: string): { sha: string; subject: string }[] {
  try {
    const out = execFileSync("git", ["-C", worksitePath, "log", "--format=%H%x00%s", `${from}..${to}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", subject = ""] = line.split("\0");
        return { sha, subject };
      });
  } catch {
    return [];
  }
}
