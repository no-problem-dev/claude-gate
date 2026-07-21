// ガイドの図解(docs/dashboard-design.md §5)。
// 自前 SVG・外部ライブラリなし・ライト/ダーク追従。ラベルは対訳表の日本語、識別子は小さく併記。

import { REPORT_STATE_LABEL } from "../../src/ios/words";

const box = "fill-black/4 stroke-black/15 dark:fill-white/6 dark:stroke-white/15";
const boxGood = "fill-green-600/12 stroke-green-600/40";
const boxBad = "fill-red-600/12 stroke-red-600/40";
const boxWarn = "fill-amber-500/14 stroke-amber-500/40";
const ink = "fill-current";
const inkGood = "fill-green-700 dark:fill-green-400";
const inkBad = "fill-red-700 dark:fill-red-400";
const inkWarn = "fill-amber-700 dark:fill-amber-400";
const inkSub = "fill-zinc-500 dark:fill-zinc-400";
const line = "stroke-zinc-400 dark:stroke-zinc-500";
const arrowFill = "fill-zinc-400 dark:fill-zinc-500";

function Arrow({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={arrowFill} />
      </marker>
    </defs>
  );
}

function Box({
  x,
  y,
  w,
  h = 40,
  label,
  sub,
  tone,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  sub?: string;
  tone?: "good" | "bad" | "warn";
}) {
  const rectClass = tone === "good" ? boxGood : tone === "bad" ? boxBad : tone === "warn" ? boxWarn : box;
  const textClass = tone === "good" ? inkGood : tone === "bad" ? inkBad : tone === "warn" ? inkWarn : ink;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" strokeWidth="1" className={rectClass} />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 5 : y + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
        fontWeight="600"
        className={textClass}
      >
        {label}
      </text>
      {sub && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 11}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="9.5"
          className={`${inkSub} font-mono`}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

// ③ どう動く: 主経路と受理/拒否の分岐、拒否からの戻り
export function LoopDiagram() {
  return (
    <svg viewBox="0 0 760 208" className="h-auto w-full text-zinc-800 dark:text-zinc-100" role="img" aria-label="ループの遷移図: コミット、ビルド、登録、観測、照合を経て受理または拒否。拒否からは直して登録・観測に戻る">
      <Arrow id="lp" />
      <Box x={8} y={62} w={86} label="コミット" />
      <line x1={94} y1={82} x2={116} y2={82} strokeWidth="1.3" className={line} markerEnd="url(#lp)" />
      <Box x={118} y={62} w={76} label="ビルド" />
      <line x1={194} y1={82} x2={216} y2={82} strokeWidth="1.3" className={line} markerEnd="url(#lp)" />
      <Box x={218} y={62} w={100} h={46} label="登録" sub="register_build" />
      <line x1={318} y1={84} x2={340} y2={84} strokeWidth="1.3" className={line} markerEnd="url(#lp)" />
      <Box x={342} y={62} w={76} label="観測" />
      <line x1={418} y1={82} x2={440} y2={82} strokeWidth="1.3" className={line} markerEnd="url(#lp)" />
      <Box x={442} y={62} w={104} h={46} label="照合" sub="attach_evidence" />

      <line x1={546} y1={74} x2={608} y2={44} strokeWidth="1.3" className={line} markerEnd="url(#lp)" />
      <text x={568} y={48} fontSize="10" className={inkSub}>一致</text>
      <Box x={612} y={20} w={140} label="✓ 受理 = 証拠" tone="good" />

      <line x1={546} y1={96} x2={608} y2={128} strokeWidth="1.3" className={line} markerEnd="url(#lp)" />
      <text x={562} y={124} fontSize="10" className={inkSub}>別物</text>
      <Box x={612} y={112} w={140} label="✕ 拒否" tone="bad" />

      <path d="M 682 152 L 682 184 L 268 184 L 268 116" fill="none" strokeWidth="1.3" strokeDasharray="4 3" className={line} markerEnd="url(#lp)" />
      <text x={475} y={178} textAnchor="middle" fontSize="10.5" className={inkSub}>
        理由と直し方が返る — 直して、登録と観測をやり直す
      </text>
    </svg>
  );
}

// ③ どう動く: 出所照合(2経路が「一致?」で合流する)
export function VerifyDiagram() {
  return (
    <svg viewBox="0 0 760 214" className="h-auto w-full text-zinc-800 dark:text-zinc-100" role="img" aria-label="出所照合の図: 登録のときに .app の中身からビルドID を計算し、受理のときにシミュレータ内の実物から再計算して、一致すれば受理、別物なら拒否">
      <Arrow id="vf" />
      <text x={10} y={26} fontSize="10.5" fontWeight="600" className={inkSub}>登録のとき</text>
      <Box x={8} y={38} w={150} label=".app 成果物" />
      <line x1={158} y1={58} x2={248} y2={58} strokeWidth="1.3" className={line} markerEnd="url(#vf)" />
      <text x={203} y={48} textAnchor="middle" fontSize="10" className={inkSub}>中身から計算</text>
      <Box x={252} y={38} w={168} h={44} label="ビルドID" sub="b43a458deb44" />

      <text x={10} y={140} fontSize="10.5" fontWeight="600" className={inkSub}>受理のとき</text>
      <Box x={8} y={152} w={150} label="シミュレータ内の実物" />
      <line x1={158} y1={172} x2={248} y2={172} strokeWidth="1.3" className={line} markerEnd="url(#vf)" />
      <text x={203} y={162} textAnchor="middle" fontSize="10" className={inkSub}>もう一度計算</text>
      <Box x={252} y={150} w={168} h={44} label="ビルドID" sub="?" />

      <line x1={420} y1={60} x2={488} y2={98} strokeWidth="1.3" className={line} markerEnd="url(#vf)" />
      <line x1={420} y1={172} x2={488} y2={128} strokeWidth="1.3" className={line} markerEnd="url(#vf)" />
      <Box x={492} y={92} w={86} label="一致?" />

      <line x1={578} y1={102} x2={630} y2={62} strokeWidth="1.3" className={line} markerEnd="url(#vf)" />
      <text x={596} y={68} fontSize="10" className={inkSub}>はい</text>
      <Box x={634} y={40} w={118} label="✓ 受理" tone="good" />

      <line x1={578} y1={124} x2={630} y2={162} strokeWidth="1.3" className={line} markerEnd="url(#vf)" />
      <text x={590} y={160} fontSize="10" className={inkSub}>いいえ</text>
      <Box x={634} y={150} w={118} label="✕ 拒否" tone="bad" />
    </svg>
  );
}

// ⑤ いま: 完了報告の一生(ドメインモデル §3.2 の写し。スライス2 で実装)
export function ReportStateDiagram() {
  return (
    <svg viewBox="0 0 760 232" className="h-auto w-full text-zinc-800 dark:text-zinc-100" role="img" aria-label="完了報告の状態遷移図: 下書きから証拠ありへ、判定で合格・不合格・確認できずに分かれ、合格だけが提出済みに進む。確認できずは人間に渡す">
      <Arrow id="st" />
      <Box x={8} y={92} w={92} label={REPORT_STATE_LABEL.draft} />
      <line x1={100} y1={112} x2={172} y2={112} strokeWidth="1.3" className={line} markerEnd="url(#st)" />
      <text x={136} y={102} textAnchor="middle" fontSize="10" className={inkSub}>証拠を付ける</text>
      <Box x={176} y={92} w={104} label={REPORT_STATE_LABEL.evidenced} />

      <line x1={280} y1={104} x2={356} y2={44} strokeWidth="1.3" className={line} markerEnd="url(#st)" />
      <line x1={280} y1={112} x2={356} y2={112} strokeWidth="1.3" className={line} markerEnd="url(#st)" />
      <line x1={280} y1={120} x2={356} y2={182} strokeWidth="1.3" className={line} markerEnd="url(#st)" />
      <text x={318} y={92} textAnchor="middle" fontSize="10" className={inkSub}>判定</text>

      <Box x={360} y={22} w={104} label={REPORT_STATE_LABEL.passed} tone="good" />
      <line x1={464} y1={42} x2={548} y2={42} strokeWidth="1.3" className={line} markerEnd="url(#st)" />
      <text x={506} y={32} textAnchor="middle" fontSize="10" className={inkSub}>提出する</text>
      <Box x={552} y={22} w={120} h={44} label={REPORT_STATE_LABEL.submitted} sub="PR レビュー依頼済み" />

      <Box x={360} y={92} w={104} label={REPORT_STATE_LABEL.failed} tone="bad" />
      <path d="M 412 132 L 412 158 L 228 158 L 228 132" fill="none" strokeWidth="1.3" strokeDasharray="4 3" className={line} markerEnd="url(#st)" />
      <text x={320} y={152} textAnchor="middle" fontSize="10" className={inkSub}>直して証拠を集め直す</text>

      <Box x={360} y={180} w={120} label={REPORT_STATE_LABEL.unconfirmed} tone="warn" />
      <line x1={480} y1={200} x2={548} y2={200} strokeWidth="1.3" className={line} markerEnd="url(#st)" />
      <Box x={552} y={180} w={120} label="人間に渡す" />
    </svg>
  );
}
