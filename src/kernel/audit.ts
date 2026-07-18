import { appendFileSync } from "node:fs";
import { join } from "node:path";

// 監査ログ: 成功も拒否も、全呼び出しを1行ずつ追記する(状態はべき等、記録は毎回)
export function appendEvent(gateDir: string, event: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  appendFileSync(join(gateDir, "events.jsonl"), line + "\n");
}
