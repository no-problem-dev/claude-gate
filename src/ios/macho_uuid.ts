import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

// 実機レポート(device_report)の出所照合。
// 実機からは .app を取り出せない(コンテナが取れない)ため、ビルドの中身ハッシュでは照合できない。
// 代わりに Mach-O の LC_UUID(リンク時にビルドごとに決まる識別子)で照合する:
//   ① register_build 時に .app の実行バイナリから LC_UUID を抽出して記録(arch ごとに1つ)
//   ② アプリは実行時に自分の LC_UUID を取得できる(下の SWIFT_SELF_REPORT_SNIPPET)ので、
//      セルフレポートに buildUUID=<uuid> 行を含める規約にする
//   ③ attach_evidence(device_report)は レポートの buildUUID を登録済みビルドの UUID 集合と照合する

const UUID_PATTERN = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/;

// dwarfdump --uuid の出力をパースして UUID を抜き出す(純関数・テスト対象)。
// 出力例: "UUID: 1B7C4E5A-... (arm64) /path/App.app/App"(fat バイナリは arch ごとに複数行)
export function parseDwarfdumpUuids(output: string): string[] {
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const match = line.match(new RegExp(`UUID:\\s*(${UUID_PATTERN.source})`));
    if (match !== null) seen.add(match[1].toUpperCase());
  }
  return [...seen];
}

// セルフレポート本文から buildUUID=<uuid> を1つ抜き出す(純関数・テスト対象)。無ければ null
export function parseBuildUuid(text: string): string | null {
  const match = text.match(new RegExp(`buildUUID[\\s=:]+(${UUID_PATTERN.source})`));
  return match !== null ? match[1].toUpperCase() : null;
}

// .app 内の実行バイナリの場所。Info.plist の CFBundleExecutable を優先、取れなければ .app 名から推定
function executableIn(appPath: string): string {
  try {
    const name = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print CFBundleExecutable", join(appPath, "Info.plist")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (name.length > 0) return join(appPath, name);
  } catch {
    // Info.plist が無い / CFBundleExecutable が無い場合は名前から推定にフォールバック
  }
  return join(appPath, basename(appPath).replace(/\.app$/, ""));
}

// .app の実行バイナリから Mach-O UUID を取り出す。
// 抽出できない(実バイナリでない・dwarfdump が無い)場合は空配列 — register_build は成功させ、
// device_report の照合時にだけ「UUID の記録がない」と分かる(スクショ系の証拠は影響を受けない)
export function machoUuidsOf(appPath: string): string[] {
  try {
    const exe = executableIn(appPath);
    if (!existsSync(exe)) return [];
    const out = execFileSync("dwarfdump", ["--uuid", exe], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseDwarfdumpUuids(out);
  } catch {
    return [];
  }
}

// アプリが自分の LC_UUID を print するための Swift スニペット(エージェントが写して使う)。
// セルフレポートの最初の方でこれを print し、その出力を device_report の file として渡す
export const SWIFT_SELF_REPORT_SNIPPET = `import MachO

func currentBuildUUID() -> String? {
    guard let header = _dyld_get_image_header(0) else { return nil }  // image 0 = 実行バイナリ本体
    return header.withMemoryRebound(to: mach_header_64.self, capacity: 1) { mh in
        var cursor = UnsafeRawPointer(mh).advanced(by: MemoryLayout<mach_header_64>.size)
        for _ in 0..<mh.pointee.ncmds {
            let cmd = cursor.assumingMemoryBound(to: load_command.self)
            if cmd.pointee.cmd == LC_UUID {
                return UUID(uuid: cursor.assumingMemoryBound(to: uuid_command.self).pointee.uuid).uuidString
            }
            cursor = cursor.advanced(by: Int(cmd.pointee.cmdsize))
        }
        return nil
    }
}
// 起動直後などに print することで、コンソール回収したログが出所照合に使える
print("buildUUID=\\(currentBuildUUID() ?? "unknown")")`;
