import { describe, expect, it } from "vitest";
import { parseBuildUuid, parseDwarfdumpUuids } from "../src/ios/macho_uuid.js";

// LC_UUID の抽出・照合ロジックの純関数テスト(実バイナリ生成は重いので、
// dwarfdump 出力のパースと セルフレポートの buildUUID 抽出をテキストで固定する)

const FAT_DWARFDUMP = `UUID: 1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D (arm64) /path/App.app/App
UUID: 2c8d5f6b-0e3f-4b5c-9d7e-1f2a3b4c5d6e (x86_64) /path/App.app/App
`;

describe("parseDwarfdumpUuids", () => {
  it("arch ごとの UUID を全部抜き出し、大文字に正規化する", () => {
    expect(parseDwarfdumpUuids(FAT_DWARFDUMP)).toEqual([
      "1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D",
      "2C8D5F6B-0E3F-4B5C-9D7E-1F2A3B4C5D6E",
    ]);
  });

  it("UUID を含まない出力では空配列", () => {
    expect(parseDwarfdumpUuids("dwarfdump: no such file")).toEqual([]);
  });

  it("同じ UUID の重複行は1件に潰す", () => {
    const dup = `UUID: 1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D (arm64) /a\nUUID: 1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D (arm64e) /a\n`;
    expect(parseDwarfdumpUuids(dup)).toEqual(["1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D"]);
  });
});

describe("parseBuildUuid", () => {
  it("セルフレポート本文の buildUUID= 行を抜き出し、大文字に正規化する", () => {
    const log = `[boot] starting\nbuildUUID=2c8d5f6b-0e3f-4b5c-9d7e-1f2a3b4c5d6e\n[SPIKE] restored session\n`;
    expect(parseBuildUuid(log)).toBe("2C8D5F6B-0E3F-4B5C-9D7E-1F2A3B4C5D6E");
  });

  it("buildUUID 行が無ければ null", () => {
    expect(parseBuildUuid("[boot] no uuid printed here")).toBeNull();
  });

  it("buildUUID: コロン区切りでも拾う", () => {
    expect(parseBuildUuid("buildUUID: 1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D")).toBe(
      "1B7C4E5A-9D2F-3A4B-8C6D-0E1F2A3B4C5D",
    );
  });
});
