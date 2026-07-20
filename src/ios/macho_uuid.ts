import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

// 実機レポート(device_report)の出所照合。
// 実機からは .app を取り出せない(コンテナが取れない)ため、ビルドの中身ハッシュでは照合できない。
// 代わりに Mach-O の LC_UUID(リンク時にビルドごとに決まる識別子)で照合する:
//   ① register_build 時に .app 内の全 Mach-O から LC_UUID を抽出して集合で記録
//   ② アプリは実行時に自分の LC_UUID を取得できる(下の SWIFT_SELF_REPORT_SNIPPET)ので、
//      セルフレポートに buildUUID=<uuid> 行を含める規約にする
//   ③ attach_evidence(device_report)は レポートの buildUUID を登録済みビルドの UUID 集合と照合する
//
// なぜ「全 Mach-O」か: Xcode 16+ の Debug ビルドは実行コードを <App>.debug.dylib に置き、
// メイン実行ファイルはビルド間で不変のスタブになる。メイン実行ファイルの UUID だけを見ると、
// 内容の違う 2 ビルドが同じ UUID になり古いビルドを受理してしまう(実測)。
// そこで .debug.dylib と Frameworks 内バイナリまで含めて集合を作り、
// アプリ側は「自分のコードが載っている image」(#dsohandle = Debug では .debug.dylib)の UUID を報告する。

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

// .app 内の照合対象 Mach-O の場所を列挙する(存在するものだけ)。
// メイン実行ファイル + <exe>.debug.dylib(Xcode 16+ Debug の実コード)+ Frameworks/*.framework 内バイナリ。
// パスの組み立てだけで dwarfdump に依存しない(列挙ロジック単体をテストできる)
export function machoBinariesIn(appPath: string): string[] {
  const bins: string[] = [];
  const push = (path: string) => {
    if (existsSync(path)) bins.push(path);
  };

  const mainExe = executableIn(appPath);
  push(mainExe);
  push(`${mainExe}.debug.dylib`); // 例: Foo.app/Foo.debug.dylib(Debug ビルドの実コード)

  const frameworksDir = join(appPath, "Frameworks");
  if (existsSync(frameworksDir)) {
    for (const entry of readdirSync(frameworksDir)) {
      if (!entry.endsWith(".framework")) continue;
      const fwBin = join(frameworksDir, entry, entry.replace(/\.framework$/, ""));
      push(fwBin);
      push(`${fwBin}.debug.dylib`);
    }
  }
  return bins;
}

// .app 内の全 Mach-O から LC_UUID を集める(arch ごと・重複は潰す)。
// 抽出できない(実バイナリでない・dwarfdump が無い)場合は空配列 — register_build は成功させ、
// device_report の照合時にだけ「UUID の記録がない」と分かる(スクショ系の証拠は影響を受けない)。
// 個々のバイナリの dwarfdump 失敗は握って次へ進む(1つの非 Mach-O で全体を空にしない)
export function machoUuidsOf(appPath: string): string[] {
  const uuids = new Set<string>();
  for (const bin of machoBinariesIn(appPath)) {
    try {
      const out = execFileSync("dwarfdump", ["--uuid", bin], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const uuid of parseDwarfdumpUuids(out)) uuids.add(uuid);
    } catch {
      // このバイナリは読めない(非 Mach-O・dwarfdump 不在)。他のバイナリで続行
    }
  }
  return [...uuids];
}

// アプリが自分の LC_UUID を print するための Swift スニペット(エージェントが写して使う)。
// #dsohandle は「この行のコードが載っている image」の Mach-O ヘッダを指す。
// Xcode 16+ Debug ビルドでは実コードが <App>.debug.dylib にあり、#dsohandle はその dylib を指す —
// メイン実行ファイル(不変スタブ)ではなく、ビルドごとに変わる実コードの UUID を報告できる。
// セルフレポートの最初の方でこれを print し、その出力を device_report の file として渡す
export const SWIFT_SELF_REPORT_SNIPPET = `import MachO

// dso 既定引数の #dsohandle は呼び出し元(アプリのコード)が載っている image を指す
func currentBuildUUID(dso: UnsafeRawPointer = #dsohandle) -> String {
    let header = dso.assumingMemoryBound(to: mach_header_64.self)
    var cursor = UnsafeRawPointer(header).advanced(by: MemoryLayout<mach_header_64>.size)
    for _ in 0..<header.pointee.ncmds {
        let cmd = cursor.assumingMemoryBound(to: load_command.self)
        if cmd.pointee.cmd == LC_UUID {
            return UUID(uuid: cursor.assumingMemoryBound(to: uuid_command.self).pointee.uuid).uuidString
        }
        cursor = cursor.advanced(by: Int(cmd.pointee.cmdsize))
    }
    return "unknown"
}
// 起動直後などに print することで、コンソール回収したログが出所照合に使える
print("buildUUID=\\(currentBuildUUID())")`;
