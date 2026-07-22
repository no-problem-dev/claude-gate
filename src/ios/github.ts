import { execFileSync } from "node:child_process";

// GitHub CLI(gh)の呼び出し。デーモンは launchd 常駐で PATH が最小(/usr/bin:/bin 等)のため、
// PATH で見つからなければ Homebrew の定位置を探す。失敗は呼び出し側が rejected にする(silent fallback 禁止)

const GH_CANDIDATES = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];

export function resolveGh(): string | null {
  for (const gh of GH_CANDIDATES) {
    try {
      execFileSync(gh, ["--version"], { stdio: "ignore" });
      return gh;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

// 下書きPR(共有の置き場)の照合に使う最小の形
export interface PullRequest {
  number: number;
  url: string;
  isDraft: boolean;
  state: string; // OPEN / CLOSED / MERGED
  headRefOid: string;
}

export type PrLookup =
  | { status: "found"; pr: PullRequest }
  | { status: "none" } // このブランチの PR が無い
  | { status: "error"; detail: string };

// branch 指定時はそのブランチの PR を引く(ローカルのチェックアウト状態に依存しない)。
// 省略時は cwd のチェックアウト中ブランチの PR(旧形式の報告向け)
export function prView(gh: string, worksitePath: string, branch?: string): PrLookup {
  try {
    const out = execFileSync(
      gh,
      ["pr", "view", ...(branch !== undefined ? [branch] : []), "--json", "number,url,isDraft,state,headRefOid"],
      {
        cwd: worksitePath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { status: "found", pr: JSON.parse(out) as PullRequest };
  } catch (error) {
    const stderr = ((error as { stderr?: string }).stderr ?? String(error)).trim();
    if (stderr.includes("no pull requests found")) return { status: "none" };
    return { status: "error", detail: stderr };
  }
}

export function prReady(
  gh: string,
  worksitePath: string,
  prNumber: number,
): { ok: true } | { ok: false; detail: string } {
  try {
    execFileSync(gh, ["pr", "ready", String(prNumber)], {
      cwd: worksitePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: ((error as { stderr?: string }).stderr ?? String(error)).trim() };
  }
}
