import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import "@xyflow/react/dist/style.css";
import {
  CONCEPTS,
  CONCEPT_CATEGORY_LABEL,
  DOMAIN_RELATIONS,
  type ConceptCategory,
  type ConceptId,
} from "../../src/ios/words";

// モデル全体図: words.ts の概念台帳(CONCEPTS)と関係(DOMAIN_RELATIONS)のレンダリング。
// このファイルはレイアウトと見た目だけを持ち、ノード・エッジ・ラベルのデータは一切持たない
// (docs/dashboard-design.md §モデル全体図)。ガイドの読み物としてスクロールを奪わない設定にする。

// 分類の色。識別の色相域(状態色を除外したシアン〜マゼンタ)から割り当て、意味色を使わない
const CATEGORY_COLOR: Record<ConceptCategory, string> = {
  actor: "oklch(0.62 0.19 300)", // 紫
  record: "oklch(0.58 0.16 250)", // 青
  vocabulary: "oklch(0.60 0.12 210)", // シアン
  derived: "oklch(0.62 0.19 330)", // マゼンタ
  operation: "oklch(0.58 0.15 275)", // 藍
  world: "oklch(0.60 0.11 190)", // 青緑
};

// 面塗りは分類色のうすい重ね(色相の識別を面でも支える。枠線だけだと一覧性が落ちる)
const TINT = Object.fromEntries(
  (Object.keys(CATEGORY_COLOR) as ConceptCategory[]).map((k) => [
    k,
    `color-mix(in oklab, ${CATEGORY_COLOR[k]} 12%, transparent)`,
  ]),
) as Record<ConceptCategory, string>;

type ConceptNodeType = Node<{ id: ConceptId }, "concept">;

function conceptSize(id: ConceptId): { width: number; height: number } {
  const c = CONCEPTS[id];
  const width = Math.max(c.ja.length * 13.5, c.en.length * 6.8) + 26;
  return { width: Math.max(width, 88), height: 50 };
}

function ConceptNode({ data }: NodeProps<ConceptNodeType>) {
  const c = CONCEPTS[data.id];
  return (
    <div
      className="rounded-lg border bg-white px-3 py-1.5 text-center dark:bg-zinc-900"
      style={{
        borderColor: CATEGORY_COLOR[c.category],
        borderWidth: 1.5,
        backgroundImage: `linear-gradient(${TINT[c.category]}, ${TINT[c.category]})`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <div className="text-[13px] leading-tight font-semibold whitespace-nowrap">{c.ja}</div>
      <div className="font-mono text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">{c.en}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

const nodeTypes = { concept: ConceptNode };

// グラフに出す概念 = 関係の端点(関係を持たない語は対訳表だけに出る)
const GRAPH_CONCEPTS = [...new Set(DOMAIN_RELATIONS.flatMap((r) => [r.from, r.to]))];

// エッジのラベルは個別の説明(label)だけを出す。既定の読み(持つ/参照する/作る)は
// 線種と矢印に任せて省略する — 32ノード×49エッジで全部に文字を出すと図が読めない。
// derives_from は宣言では「導出が出自を指す」が、描画は「出自 → 導出」の向きに反転する —
// 図は左から右へ「作られたものから導出が生まれる」流れとして読めるようにする(破線が導出の印)
const VISUAL_EDGES = DOMAIN_RELATIONS.map((r, i) => ({
  id: `r${i}`,
  source: r.kind === "derives_from" ? r.to : r.from,
  target: r.kind === "derives_from" ? r.from : r.to,
  relation: r,
}));

const BASE_EDGES: Edge[] = VISUAL_EDGES.map(({ id, source, target, relation: r }) => ({
  id,
  source,
  target,
  label: r.label,
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  style: r.kind === "derives_from" ? { strokeDasharray: "6 4" } : r.kind === "is_a" ? { strokeDasharray: "2 3" } : undefined,
  labelStyle: { fontSize: 10 },
  labelBgStyle: { fillOpacity: 0.85 },
}));

async function layout(): Promise<ConceptNodeType[]> {
  const elk = new ELK();
  const sizes = Object.fromEntries(GRAPH_CONCEPTS.map((id) => [id, conceptSize(id)]));
  const result = await elk.layout({
    id: "domain-model",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "84",
      "elk.spacing.nodeNode": "22",
      "elk.layered.compaction.postCompaction.strategy": "LEFT",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.edgeRouting": "SPLINES",
    },
    children: GRAPH_CONCEPTS.map((id) => ({ id, ...sizes[id] })),
    edges: VISUAL_EDGES.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  return (result.children ?? []).map((c) => ({
    id: c.id,
    type: "concept" as const,
    position: { x: c.x ?? 0, y: c.y ?? 0 },
    data: { id: c.id as ConceptId },
    width: c.width,
    height: c.height,
  }));
}

// ホバー中のノードの近傍(自分 + 直接つながる概念・関係)。密なグラフを「見たいところだけ」読めるようにする
const NEIGHBORS = new Map<string, Set<string>>();
for (const id of GRAPH_CONCEPTS) NEIGHBORS.set(id, new Set([id]));
for (const e of VISUAL_EDGES) {
  NEIGHBORS.get(e.source)?.add(e.target);
  NEIGHBORS.get(e.target)?.add(e.source);
}

export default function DomainModelGraph() {
  const [nodes, setNodes] = useState<ConceptNodeType[] | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    layout().then((n) => {
      if (alive) setNodes(n);
    });
    return () => {
      alive = false;
    };
  }, []);

  const visibleNodes = useMemo(() => {
    if (!nodes) return null;
    if (!hovered) return nodes;
    const keep = NEIGHBORS.get(hovered)!;
    return nodes.map((n) => (keep.has(n.id) ? n : { ...n, style: { opacity: 0.12 } }));
  }, [nodes, hovered]);

  const visibleEdges = useMemo(() => {
    if (!hovered) return BASE_EDGES;
    return BASE_EDGES.map((e) =>
      e.source === hovered || e.target === hovered
        ? { ...e, style: { ...e.style, strokeWidth: 2 } }
        : { ...e, style: { ...e.style, opacity: 0.06 }, label: undefined },
    );
  }, [hovered]);

  const legend = useMemo(
    () =>
      (Object.keys(CONCEPT_CATEGORY_LABEL) as ConceptCategory[]).map((cat) => (
        <span key={cat} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
          <span aria-hidden className="size-2.5 rounded-full border-[1.5px]" style={{ borderColor: CATEGORY_COLOR[cat] }} />
          {CONCEPT_CATEGORY_LABEL[cat]}
        </span>
      )),
    [],
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">{legend}</div>
      <div className="h-[720px] rounded-lg border border-black/8 dark:border-white/8">
        {visibleNodes === null ? (
          <div className="grid h-full place-items-center text-[13px] text-zinc-500 dark:text-zinc-400">
            全体図を配置しています…
          </div>
        ) : (
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            onNodeMouseEnter={(_, n) => setHovered(n.id)}
            onNodeMouseLeave={() => setHovered(null)}
            colorMode="system"
            fitView
            minZoom={0.15}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            zoomOnScroll={false}
            panOnScroll={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
