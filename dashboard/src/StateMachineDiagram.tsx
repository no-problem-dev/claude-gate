import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { REPORT_STATE_LABEL, REPORT_TRANSITIONS, type ReportState } from "../../src/ios/words";

// 状態マシン図: words.ts の遷移宣言(REPORT_TRANSITIONS)のレンダリング。
// ノード・エッジ・ラベルのデータは宣言が SSOT で、このファイルはレイアウトと見た目だけを持つ。
// 配置は物語の順(下書き → 証拠あり → 判定の3値 → 提出済み)に固定する — 自動レイアウトは
// 戻りの遷移に引きずられて読む順が壊れる(実測)。状態の色は既存の表現ルールに従う
// (合格 = success / 不合格 = danger / 確認できず = warning。色+ラベル併記、終着はアウトライン)

const STATE_STYLE: Record<ReportState, string> = {
  draft: "border-zinc-400 bg-zinc-500/10 dark:border-zinc-500",
  evidenced: "border-blue-500 bg-blue-500/10",
  passed: "border-green-600 bg-green-600/12 dark:border-green-500",
  failed: "border-red-600 bg-red-600/12 dark:border-red-500",
  unconfirmed: "border-amber-500 bg-amber-500/12",
  submitted: "border-zinc-400 bg-transparent dark:border-zinc-500",
};

// 物語の順の固定配置(表現側の都合。宣言には座標を持ち込まない)
const POSITION: Record<ReportState, { x: number; y: number }> = {
  draft: { x: 0, y: 170 },
  evidenced: { x: 300, y: 170 },
  passed: { x: 660, y: 10 },
  failed: { x: 660, y: 170 },
  unconfirmed: { x: 660, y: 340 },
  submitted: { x: 1020, y: 10 },
};

type StateNodeType = Node<{ state: ReportState }, "state">;

function StateNode({ data }: NodeProps<StateNodeType>) {
  const invisible = "!bg-transparent !border-0";
  return (
    <div className={`rounded-full border-[1.5px] px-5 py-2.5 text-center ${STATE_STYLE[data.state]}`}>
      <Handle type="target" position={Position.Left} id="l" className={invisible} />
      <Handle type="source" position={Position.Right} id="r" className={invisible} />
      <Handle type="source" position={Position.Top} id="st" className={invisible} />
      <Handle type="target" position={Position.Top} id="tt" className={invisible} />
      <Handle type="source" position={Position.Bottom} id="sb" className={invisible} />
      <Handle type="target" position={Position.Bottom} id="tb" className={invisible} />
      <div className="text-[14px] leading-tight font-semibold whitespace-nowrap">
        {REPORT_STATE_LABEL[data.state]}
      </div>
      <div className="font-mono text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">{data.state}</div>
    </div>
  );
}

const nodeTypes = { state: StateNode };

const NODES: StateNodeType[] = (Object.keys(POSITION) as ReportState[]).map((s) => ({
  id: s,
  type: "state",
  position: POSITION[s],
  data: { state: s },
}));

// 戻り(判定の無効化・集め直し)は破線で、上下の別レーンを通す — 主経路(左→右)と交差させない
const EDGES: Edge[] = REPORT_TRANSITIONS.map((t, i) => {
  const isReturn = t.to === "evidenced" && t.from !== "draft";
  const viaTop = t.from === "passed";
  return {
    id: `t${i}`,
    source: t.from,
    target: t.to,
    sourceHandle: isReturn ? (viaTop ? "st" : "sb") : "r",
    targetHandle: isReturn ? (viaTop ? "tt" : "tb") : "l",
    label: t.label,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: isReturn ? { strokeDasharray: "6 4" } : undefined,
    labelStyle: { fontSize: 11 },
    labelBgStyle: { fillOpacity: 0.85 },
  };
});

export default function StateMachineDiagram() {
  return (
    <div className="h-[440px] rounded-lg border border-black/8 dark:border-white/8">
      <ReactFlow
        nodes={NODES}
        edges={EDGES}
        nodeTypes={nodeTypes}
        colorMode="system"
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
      >
        <Background gap={24} />
      </ReactFlow>
    </div>
  );
}
