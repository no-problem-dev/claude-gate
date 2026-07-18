import { execFileSync } from "node:child_process";

// シミュレータにインストールされている実物のアプリの場所を Apple 純正コマンドで取得する
export function installedAppPath(simulatorUdid: string, bundleId: string): string {
  return execFileSync("xcrun", ["simctl", "get_app_container", simulatorUdid, bundleId, "app"], {
    encoding: "utf8",
  }).trim();
}
