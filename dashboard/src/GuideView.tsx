import { Card, Chip } from "@heroui/react";
import { SectionTitle } from "./BuildsTab";

// ガイド: この仕組み(形式言語)の人間向け説明書。
// 内容は言語定義(life リポ os/write/ios-domain-model.md ほか)のレンダリング。
// 言語を変えたらここも同じ変更で更新する(docs/dashboard-design.md §5)

export function GuideView() {
  return (
    <div className="max-w-[760px]">
      {/* ① これは何 */}
      <section className="pt-2 pb-8">
        <h2 className="text-2xl leading-snug font-semibold tracking-tight">
          AI の「できました」に、
          <br />
          証拠を義務づける仕組み。
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          エージェントの作業は自由。ただし「確認した」「直った」と報告するには、
          <strong className="text-foreground">ゲートが受理した観測だけが根拠</strong>になる。
          受理のたびに、ゲートは観測が本当にそのビルドから取れたかを機械的に照合する。
          このダッシュボードは、その受理・拒否の記録を人間が見るための場所。
        </p>
      </section>

      {/* ② なぜ */}
      <section className="pb-8">
        <SectionTitle>なぜ作ったか — 実際に起きた事故から</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <AccidentCard title="古いビルドを見て「直った」と誤判定">
            シミュレータに残っていた古いビルドのスクショを見て「修正済み」と報告していた。
            証拠に「どのビルドを見たか」という<strong>出所</strong>がなかった。
          </AccidentCard>
          <AccidentCard title="実行せずに完了報告">
            「QA やって」に対してテストケースの文書だけを納品し、実行しなかった。
            完了報告が<strong>実行の証拠なし</strong>に成立していた。
          </AccidentCard>
          <AccidentCard title="お願いベースのゲートは破れる">
            「問題を無視して PASS にするな」と書いたスキルは、書いてあるだけで守られる保証がない。
            <strong>約束ではなく構造</strong>で守る必要があった。
          </AccidentCard>
        </div>
        <Card className="mt-3 p-4">
          <p className="text-[14px] leading-relaxed">
            結論: 決まりはプロンプト(お願い)ではなく、<strong>型と照合(構造)</strong>で書く。
            AI に任せる領域と人間が握る領域の境界線を、言葉の定義と機械的な検査で引く —
            それがこの形式言語の思想。全ての決まりは実際に起きた事故に由来し、
            それっぽい一般論からは作らない。
          </p>
        </Card>
      </section>

      {/* ③ どう動く */}
      <section className="pb-8">
        <SectionTitle>どう動くか — 証拠つき完了報告のループ</SectionTitle>
        <ol className="grid gap-2">
          <Step n={1} name="コミット">
            証拠にするビルドは、コミットしてから作る。しないと「未コミット変更あり」が記録に残り、
            どのコミットの成果物か確定できなくなる。
          </Step>
          <Step n={2} name="ビルド">
            ふだん通り自由にビルドする。ゲートは実行を縛らない(試行錯誤のビルドは登録しなければ記録されない)。
          </Step>
          <Step n={3} name="登録" en="register_build">
            成果物(.app)の中身から<strong>ビルドID</strong>を計算して記録する。
            git の commit ID と同じ仕組みなので、偽れない。
          </Step>
          <Step n={4} name="観測">
            スクショ・録画を撮り、何が写っているかを自分の目で確かめる。
          </Step>
          <Step n={5} name="照合して受理 / 拒否" en="attach_evidence">
            ゲートがシミュレータ内の<strong>実物</strong>からビルドID を計算し直し、
            登録と一致したときだけ証拠として受理する。別のビルドなら拒否(理由と直し方つき)。
          </Step>
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip size="sm" color="default">実行は自由、採用は厳格</Chip>
          <Chip size="sm" color="default">すべての操作はべき等(何度呼んでも安全)</Chip>
          <Chip size="sm" color="default">記録は不変(拒否も含めて全部残る)</Chip>
        </div>
      </section>

      {/* ④ ことば */}
      <section className="pb-8">
        <SectionTitle>ことば — この形式言語の語彙</SectionTitle>
        <Card className="mb-3 p-4">
          <p className="text-[14px] leading-relaxed">
            命名の決まりは3つ。<strong>日本語の日常語が正式名</strong>。実装用の英語識別子と
            1:1 の対訳表を持つ(表にない語は実装に登場できない)。<strong>比喩は使わない</strong>
            (「指紋」は分かりにくいので「ビルドID」に改名した、という実例からの決まり)。
          </p>
        </Card>
        <Card className="overflow-hidden p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-black/8 text-left dark:border-white/8">
                <th className="px-4 py-2.5 font-semibold">正式名</th>
                <th className="px-4 py-2.5 font-mono text-xs font-normal text-zinc-500 dark:text-zinc-400">識別子</th>
                <th className="px-4 py-2.5 font-semibold">意味</th>
              </tr>
            </thead>
            <tbody>
              <Word ja="ビルド" en="build">検証対象の成果物</Word>
              <Word ja="ビルドID" en="build_id">中身から計算する同一性。偽れない</Word>
              <Word ja="証拠" en="evidence">受理された観測の記録(スクショ・録画)</Word>
              <Word ja="出所" en="source">その観測がどのビルドから取れたか</Word>
              <Word ja="判定" en="verdict">OK / NG / 確認できず の3値</Word>
              <Word ja="検証器" en="verifier">観測を取る道具。見えないことがある</Word>
              <Word ja="ゲート" en="gate">受理を判断する常駐デーモン(この仕組みの実行実体)</Word>
              <Word ja="作業場" en="worksite">worktree + ビルド置き場 + 専用シミュレータの一式</Word>
              <Word ja="未コミット変更あり" en="dirty">どのコミットの成果物か確定できない状態</Word>
            </tbody>
          </table>
        </Card>
        <Card className="mt-3 p-4">
          <p className="text-[14px] leading-relaxed">
            判定が OK / NG の2値ではなく<strong>「確認できず」を含む3値</strong>なのは、
            検証器には見えないことがあるから(例: 課金フローはシミュレータの自動操作では検証が成立しない)。
            見えないものを OK / NG に潰すと、それは嘘になる。
          </p>
        </Card>
      </section>

      {/* ⑤ いま */}
      <section className="pb-8">
        <SectionTitle>いま、どこまでできているか</SectionTitle>
        <div className="grid gap-2">
          <StatusRow chip={<Chip size="sm" color="success">稼働中</Chip>} name="登録と照合(スライス1)">
            ビルドの登録・証拠の出所照合・監査記録。「古いビルドを見て誤判定」は構造的に再発できない
          </StatusRow>
          <StatusRow chip={<Chip size="sm" color="default">次</Chip>} name="完了報告と判定(スライス2)">
            完了報告(open_report)・判定(judge)・プロジェクトごとの合格ライン(gate.yaml)
          </StatusRow>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          言語定義の SSOT は life リポジトリの os/write/(ios-domain-model.md ほか)。この画面はその人間向けの説明で、言語の変更と一緒に更新される。
        </p>
      </section>
    </div>
  );
}

function AccidentCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="mb-1.5 text-[11px] font-semibold tracking-widest text-red-600 uppercase dark:text-red-400">
        実際に起きた
      </p>
      <h3 className="text-[14px] leading-snug font-semibold">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</p>
    </Card>
  );
}

function Step({ n, name, en, children }: { n: number; name: string; en?: string; children: React.ReactNode }) {
  return (
    <li>
      <Card className="flex flex-row items-start gap-3.5 p-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-black/6 text-sm font-semibold dark:bg-white/10">
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold">
            {name}
            {en && <span className="ml-2 font-mono text-xs font-normal text-zinc-500 dark:text-zinc-400">{en}</span>}
          </h3>
          <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</p>
        </div>
      </Card>
    </li>
  );
}

function Word({ ja, en, children }: { ja: string; en: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-black/5 last:border-b-0 dark:border-white/5">
      <td className="px-4 py-2 font-semibold whitespace-nowrap">{ja}</td>
      <td className="px-4 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">{en}</td>
      <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{children}</td>
    </tr>
  );
}

function StatusRow({ chip, name, children }: { chip: React.ReactNode; name: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-row items-start gap-3 p-4">
      {chip}
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold">{name}</h3>
        <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</p>
      </div>
    </Card>
  );
}
