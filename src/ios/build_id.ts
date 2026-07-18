import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

// ビルドID: .app ディレクトリの中身から決定論的に計算する。
// 中身が1バイトでも違えば別の ID になり、置き場所と走査順には影響されない。
export function buildIdOf(appPath: string): string {
  const entries: string[] = [];
  collect(appPath, "", entries);
  entries.sort();
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry + "\n");
  return hash.digest("hex");
}

export const shortBuildId = (full: string): string => full.slice(0, 12);

function collect(root: string, rel: string, out: string[]): void {
  const abs = rel === "" ? root : join(root, rel);
  for (const name of readdirSync(abs)) {
    const childRel = rel === "" ? name : `${rel}/${name}`;
    const childAbs = join(root, childRel);
    const stat = lstatSync(childAbs);
    if (stat.isSymbolicLink()) {
      out.push(`${childRel}\0link:${readlinkSync(childAbs)}`);
    } else if (stat.isDirectory()) {
      collect(root, childRel, out);
    } else {
      const contentSha = createHash("sha256").update(readFileSync(childAbs)).digest("hex");
      out.push(`${childRel}\0${contentSha}`);
    }
  }
}
