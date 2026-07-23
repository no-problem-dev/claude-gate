import { describe, expect, it } from "vitest";
import {
  CONCEPTS,
  DOMAIN_RELATIONS,
  RELATION_KIND_LABEL,
  type ConceptId,
} from "../src/ios/words";

// モデル全体図のデータ(概念の台帳と関係の宣言)の整合性。
// from/to の存在は型が守る — ここでは型で書けない決まりを検査する

describe("ドメインモデルの宣言", () => {
  it("関係に重複がない(同じ from・kind・to を二度宣言しない)", () => {
    const keys = DOMAIN_RELATIONS.map((r) => `${r.from}|${r.kind}|${r.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("自己参照の関係がない", () => {
    for (const r of DOMAIN_RELATIONS) expect(r.from).not.toBe(r.to);
  });

  it("個別ラベルは空文字にしない(無いなら省略して kind の読みに任せる)", () => {
    for (const r of DOMAIN_RELATIONS) {
      if (r.label !== undefined) expect(r.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("導出(derived)の概念は、必ず「から導出される」関係を持つ(保存しない概念に出自がある)", () => {
    const derived = (Object.keys(CONCEPTS) as ConceptId[]).filter((id) => CONCEPTS[id].category === "derived");
    for (const id of derived) {
      const hasOrigin = DOMAIN_RELATIONS.some((r) => r.from === id && r.kind === "derives_from");
      expect(hasOrigin, `${CONCEPTS[id].ja}(${id})に derives_from が無い`).toBe(true);
    }
  });

  it("記録(record)の概念は、少なくとも1つの関係に現れる(孤立した記録は台帳の書き間違い)", () => {
    const inGraph = new Set(DOMAIN_RELATIONS.flatMap((r) => [r.from, r.to]));
    const records = (Object.keys(CONCEPTS) as ConceptId[]).filter((id) => CONCEPTS[id].category === "record");
    for (const id of records) {
      expect(inGraph.has(id), `${CONCEPTS[id].ja}(${id})がどの関係にも現れない`).toBe(true);
    }
  });

  it("関係の種類には全て読み方がある", () => {
    for (const r of DOMAIN_RELATIONS) {
      expect(RELATION_KIND_LABEL[r.kind].length).toBeGreaterThan(0);
    }
  });
});
