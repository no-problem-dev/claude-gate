import { lazy, Suspense } from "react";
import { Card, Chip } from "@heroui/react";
import {
  CHANGE_KINDS,
  CHANGE_KIND_LABEL,
  CHECK_KINDS,
  CHECK_LABEL,
  CONCEPTS,
  EVIDENCE_KIND_LABEL,
  VERDICT_LABEL,
  type ConceptId,
} from "../../src/ios/words";
import { SectionTitle } from "./components";
import { LoopDiagram, VerifyDiagram } from "./Diagrams";

// モデル全体図・状態マシン図はグラフ描画(React Flow + ELK)を含むので遅延ロードする(ガイド本文を重くしない)
const DomainModelGraph = lazy(() => import("./DomainModelGraph"));
const StateMachineDiagram = lazy(() => import("./StateMachineDiagram"));

// ガイド: この仕組み(形式言語)の人間向け説明書。
// 語彙の列挙(変更の種類・確かめ方・判定値)は words.ts をそのままレンダリングする(写しを持たない)。
// 概念の一言説明だけこのファイルが持つ(docs/dashboard-design.md §5)

export function GuideView() {
  return (
    <div>
      {/* ① これは何 */}
      <section className="max-w-[760px] pt-2 pb-8">
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
      <section className="max-w-[760px] pb-8">
        <SectionTitle>なぜ作ったか — 実際に起きた事故から</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
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

        <div className="mt-3 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <RoleLane name="エージェント" verb="自由に作る">
            実装・ビルド・観測。試行錯誤は縛らない
          </RoleLane>
          <LaneArrow label="登録・添付" />
          <RoleLane name="ゲート" verb="厳格に受け取る" accent>
            出所を照合して受理 / 拒否。記録は不変
          </RoleLane>
          <LaneArrow label="記録" />
          <RoleLane name="人間" verb="観て決める">
            ダッシュボードで確認。「確認できず」「ずれ」「取り込み」を引き取る — 非同期でよい(あとからで完結する)
          </RoleLane>
        </div>
      </section>

      {/* ③ どう動く */}
      <section className="max-w-[760px] pb-8">
        <SectionTitle>どう動くか — 証拠つき完了報告のループ</SectionTitle>
        <Card className="mb-3 p-4">
          <LoopDiagram />
        </Card>
        <ol className="grid gap-2">
          <Step n={0} name="報告を開く" en="open_report">
            作業名と<strong>動作一覧</strong>(動くと言っている動作 + 使う確かめ方)を宣言する。
            動作一覧が空の報告は開けない — 証拠なしの「できました」を型で防ぐ。
          </Step>
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
            登録と一致したときだけ証拠として受理し、<strong>報告の動作に紐づける</strong>。
            別のビルドなら拒否(理由と直し方つき)。どの動作がまだ覆われていないかは
            完了報告タブのカバレッジ表に出る。
          </Step>
          <Step n={6} name="確かめを実行" en="run_check">
            テスト系(コンパイル・ユニットテスト・UIテスト)は、エージェントの「回しました」ではなく
            <strong>ゲート自身がリポジトリの gate.yaml に宣言されたコマンドを実行</strong>し、
            終了コードと出力ログをそのまま証拠にする。「テストを回したことにする」が構造的にできない。
          </Step>
          <Step n={7} name="判定" en="judge">
            全動作が適合する証拠で覆われているかをゲートが<strong>決定論で照合</strong>し、
            合格 / 不合格 / 確認できず を決める。動かしたエージェント自身は判定しない。
            証拠が複数ビルドやソースにまたがる報告は合格にならない(確認できず)。
          </Step>
          <Step n={8} name="提出" en="submit">
            検証と人間確認が終わった合格報告を、<strong>「検証したソースを受け入れた」と記録する</strong>。
            提出は記録だけの状態遷移で、push も gh も実行しない(ゲートは git・GitHub を読むだけで、書き込まない)。
            取り込みに向かう操作 — レビュー可能化(gh pr ready)・merge・デフォルトブランチへの push —
            は、この記録に依存するガード(hook・ブランチ保護・人間)が守る:
            レビュー可能化はブランチ先端がこの記録と一致するときだけ通り、
            merge とデフォルトブランチへの push は人間だけの操作。
            提出済みの報告は終着(証拠の追加も不可)。
          </Step>
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip size="sm" color="default">実行は自由、採用は厳格</Chip>
          <Chip size="sm" color="default">ゲートは git・GitHub を読むだけで、書き込まない</Chip>
          <Chip size="sm" color="default">すべての操作はべき等(何度呼んでも安全)</Chip>
          <Chip size="sm" color="default">記録は不変(拒否も含めて全部残る)</Chip>
        </div>

        <h3 className="mt-6 mb-2 text-[13px] font-semibold">人間の番 — 非同期でよい</h3>
        <Card className="p-4">
          <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            ここまでのループはエージェントの仕事。人間に残るのは<strong>3つの引き取り</strong>で、
            どれも急がなくていい — 検証は過去、確認はあとから、提出はさらにあとから、
            そのときローカルで別の作業をしていても完結する(報告が<strong>作業ブランチ</strong>に
            属しているので、ゲートはローカルの状態を見ない)。
          </p>
          <ol className="mt-3 grid gap-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            <li>
              <strong className="text-foreground">「確認できず」を確かめる</strong> —
              機械に見えない動作(課金・動きの質など)を自分の目で確かめ、報告カードの人間確認フォームか
              CLI で記録する。記録は証拠になり、自動で再判定される。
            </li>
            <li>
              <strong className="text-foreground">「ずれ」を引き取る</strong> —
              検証したソースの後にブランチへコミットが積まれると、カードにコミット一覧つきで出る
              (提出の門で初めて発覚しない)。推奨は取り直し(エージェントに再検証を依頼)。
              差分を自分の目で見て「判定は引き続き有効」と言えるときだけ、
              <strong>差分確認</strong>で引き受ける — 人間の強い権限は照合を飛ばす形ではなく、
              機械に見えない判断を記録として供給する形で行使する。
            </li>
            <li>
              <strong className="text-foreground">取り込む</strong> —
              提出(記録)は誰からでもできる(カードのボタン・CLI・エージェント)。
              提出済みなのにまだデフォルトブランチに入っていない報告は<strong>取り込み待ち</strong>として
              カードと注意帯に出る — PR 運用なら GitHub 上で merge、main 直運用なら端末から push。
              どちらも人間だけの操作。
            </li>
          </ol>
        </Card>

        <h3 className="mt-6 mb-2 text-[13px] font-semibold">出所照合のしくみ — なぜ偽れないか</h3>
        <Card className="p-4">
          <VerifyDiagram />
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            ビルドID は成果物の<strong>中身</strong>から計算する(git の commit ID と同じ仕組み)。
            受理のときはシミュレータに入っている実物からもう一度計算するので、
            「登録したものと違うビルドのスクショ」は数字が合わず、機械的に弾かれる。
          </p>
        </Card>
      </section>

      {/* ④ ことば */}
      <section className="max-w-[760px] pb-8">
        <SectionTitle>ことば — この形式言語の語彙</SectionTitle>
        <Card className="mb-3 p-4">
          <p className="text-[14px] leading-relaxed">
            命名の決まりは3つ。<strong>日本語の日常語が正式名</strong>。実装用の英語識別子と
            1:1 の対訳表を持つ(表にない語は実装に登場できない)。<strong>比喩は使わない</strong>
            (比喩で名付けて分かりにくくなり、「ビルドID」への改名で直した実例からの決まり)。
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
              <Word id="report">「できました」の型。作業名と動作一覧を持つ(空の一覧では開けない)</Word>
              <Word id="build">検証対象の成果物</Word>
              <Word id="build_id">中身から計算する同一性。偽れない</Word>
              <Word id="evidence">
                受理された観測の記録({Object.values(EVIDENCE_KIND_LABEL).join("・")})。人間確認だけは人間の CLI(claude-gate confirm)でしか作れない
              </Word>
              <Word id="source">その観測がどのビルドから取れたか</Word>
              <Word id="verdict">
                動作の判定は {Object.values(VERDICT_LABEL).join(" / ")} の3値。報告の判定は 合格 / 不合格 / 確認できず(層の違う語を混ぜない)
              </Word>
              <Word id="change_kind">
                何を変えたか({CHANGE_KINDS.map((k) => CHANGE_KIND_LABEL[k]).join(" / ")})
              </Word>
              <Word id="check">
                動作をどう確かめるか({CHECK_KINDS.map((k) => CHECK_LABEL[k]).join(" / ")})。宣言に使える語彙はこの{CHECK_KINDS.length}つに固定
              </Word>
              <Word id="passline">変更の種類ごとに使ってよい確かめ方。下げる例外は人間が gate.yaml を変える(git に残る)</Word>
              <Word id="check_run">ゲート自身がコマンドを実行した結果(終了コード + 出力ログ)の証拠</Word>
              <Word id="cannot_see">検証器に見えない領域のデータ(課金 × シミュレータ等)。一致したら判定は 確認できず</Word>
              <Word id="verifier">観測を取る道具。見えないことがある</Word>
              <Word id="gate">受理を判断する常駐デーモン(この仕組みの実行実体)</Word>
              <Word id="worksite">worktree + ビルド置き場 + 専用シミュレータの一式</Word>
              <Word id="dirty">どのコミットの成果物か確定できない状態</Word>
              <Word id="share">feature ブランチへの push・下書きPR の作成。可逆なのでエージェントの自由領域(前提: デフォルトブランチは GitHub 側のブランチ保護で守る)</Word>
              <Word id="draft_pr">共有の置き場。レビュー依頼は飛ばず、閉じれば戻る</Word>
              <Word id="branch">報告の帰属先(オープン時に記録)。人間の動きは非同期 — 差分確認・提出はローカルのチェックアウトでなくブランチを基準に動く</Word>
              <Word id="submit">検証と人間確認が終わった報告を「検証したソースを受け入れた」と記録する状態遷移。git や gh のコマンドは実行しない。FSM の終着</Word>
              <Word id="pr_ready">取り込みに向かう操作。ブランチ先端が提出の記録と一致するときだけガード(hook)が通す — エージェント自身が実行する</Word>
              <Word id="drift">検証したソースの後に作業ブランチへ積まれたコミット。状態ではなく導出 — 発生した瞬間から報告カードに出す</Word>
              <Word id="confirm_delta">ずれの差分を人間が見て「判定は引き続き有効」と引き受ける記録。人間だけの操作 — 判定が sourceSha を先へ進め、提出の記録が指す検証済みソースを最新に保つ</Word>
              <Word id="merge">不可逆の採用(merge・デフォルトブランチへの push)。人間だけの操作 — エージェントの語彙に入れない</Word>
              <Word id="awaiting_adoption">提出済みだが、受け入れた sha がまだ origin のデフォルトブランチに入っていない状態。導出(保存しない)— 人間の番</Word>
              <Word id="entered_default_branch">受け入れた sha が origin のデフォルトブランチの祖先。導出 — このマシンが最後に取得した時点の姿</Word>
            </tbody>
          </table>
        </Card>

      </section>

      {/* ④' モデル全体図: これだけ本文の幅制約(max-w-[760px])を外して広い面で描く */}
      <section className="max-w-[1400px] pb-8">
        <h3 className="mb-2 text-[13px] font-semibold">モデル全体図 — 概念と関係の1枚</h3>
        <Card className="p-4">
          <p className="mb-3 max-w-[760px] text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            この仕組みの本質は、動作確認と品質を保つ営み全体の<strong>ドメインモデリング</strong>で、
            プラグインやこのダッシュボードはその表象にすぎない。
            下の図は言語の定義(概念の台帳と関係の宣言)をそのまま描いたもの —
            実線は 持つ / 参照する / 作る、破線は<strong>導出</strong>(保存せず毎回計算する)、
            点線は「証拠の一種」。関係を持たない語(作業場・未コミット変更あり等)は上の対訳表だけに出る。
            <strong>概念にマウスを載せると、その概念と直接つながる関係だけが浮かぶ</strong>。
          </p>
          <Suspense
            fallback={
              <div className="grid h-[720px] place-items-center text-[13px] text-zinc-500 dark:text-zinc-400">
                全体図を読み込んでいます…
              </div>
            }
          >
            <DomainModelGraph />
          </Suspense>
        </Card>
      </section>

      {/* ④'' 状態マシン: 完了報告の一生。words.ts の遷移宣言(REPORT_TRANSITIONS)のレンダリング */}
      <section className="max-w-[1400px] pb-8">
        <h3 className="mb-2 text-[13px] font-semibold">状態マシン — 完了報告の一生(全状態が稼働中)</h3>
        <Card className="p-4">
          <Suspense
            fallback={
              <div className="grid h-[420px] place-items-center text-[13px] text-zinc-500 dark:text-zinc-400">
                状態マシンを読み込んでいます…
              </div>
            }
          >
            <StateMachineDiagram />
          </Suspense>
          <p className="mt-3 max-w-[760px] text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            状態はこの1本だけ。証拠を集めている間の試行錯誤は自由で、
            <strong>状態から状態への移動だけ</strong>をゲートが決定論で判定する。
            破線は戻りの遷移 — 判定済みの報告に証拠が増えると判定は無効になり「証拠あり」に戻る。
            人間確認も証拠なので、この同じ経路で自動的に再判定される(特別な遷移は無い)。
            <strong>ずれは状態ではなく導出</strong>(検証したソースの後にブランチへ積まれたコミット。
            合格のまま起きて、差分確認か取り直しで合格のまま解消される)。
            <strong>提出済みの先も導出</strong>(受け入れた sha がデフォルトブランチに入ったかは
            origin のいまの状態なので、保存せず毎回確かめる)。
            「確認できず」は失敗ではなく、人間に渡すための正式な出口。
          </p>
        </Card>
      </section>

      {/* ④''' ことばの続き */}
      <section className="max-w-[760px] pb-8">
        <Card className="p-4">
          <p className="text-[14px] leading-relaxed">
            判定が OK / NG の2値ではなく<strong>「確認できず」を含む3値</strong>なのは、
            検証器には見えないことがあるから(例: 課金フローはシミュレータの自動操作では検証が成立しない)。
            見えないものを OK / NG に潰すと、それは嘘になる。
            「確認できず」は人間に渡す正式な出口で、人間が自分の目で確かめたら記録する —
            入口は報告カードの人間確認フォーム、CLI の
            <code className="mx-1 font-mono text-xs">claude-gate confirm</code>、
            セッション内で「確認した」と伝えたときのエージェント代筆の3つ(判断者は常に人間)。
            人間確認は証拠になり、決定論の再判定が報告を前へ進める。
            同じ考え方で、検証の後にコミットが積まれて提出が止まった報告は、
            人間がずれた差分を見た上で<strong>差分確認</strong>(報告カードのフォーム、または CLI の
            <code className="mx-1 font-mono text-xs">claude-gate confirm-delta</code>)で引き受けられる —
            人間の強い権限は「照合を飛ばす」ではなく「機械に見えない判断を記録として供給する」形で行使する。
          </p>
        </Card>
      </section>

      {/* ⑤ いま */}
      <section className="max-w-[760px] pb-8">
        <SectionTitle>いま、どこまでできているか</SectionTitle>
        <div className="grid gap-2">
          <StatusRow chip={<Chip size="sm" color="success">稼働中</Chip>} name="登録と照合(スライス1)">
            ビルドの登録・証拠の出所照合・監査記録。「古いビルドを見て誤判定」は構造的に再発できない
          </StatusRow>
          <StatusRow chip={<Chip size="sm" color="success">稼働中</Chip>} name="完了報告の骨格(スライス2a)">
            報告を開く(動作一覧が空だと開けない)・動作ごとの証拠の紐づけ・カバレッジ表。
            「実行なき完了報告」に型で対抗
          </StatusRow>
          <StatusRow chip={<Chip size="sm" color="success">稼働中</Chip>} name="判定(スライス2b)">
            決定論の判定(judge)・ゲートによる確かめの実行(run_check)・リポジトリ内の宣言 gate.yaml・
            見えないこと台帳。見えない動作への OK は「確認できず」に変換され、人間に渡る
          </StatusRow>
          <StatusRow chip={<Chip size="sm" color="success">稼働中</Chip>} name="提出(記録)とガード(スライス3)+ 掃除(2c)">
            提出は「検証したソースを受け入れた」の記録だけ(git・GitHub への書き込みを含まない)。
            取り込みに向かう操作は提出の記録に依存するガードが守る: レビュー可能化はブランチ先端が
            記録と一致するときだけ hook が通し、merge とデフォルトブランチへの push は人間だけ。
            記録の掃除は人間の CLI(claude-gate forget)— エージェントは記録を消せない
          </StatusRow>
          <StatusRow chip={<Chip size="sm" color="success">稼働中</Chip>} name="人間の非同期な操作面(スライス4)">
            人間確認・差分確認・提出がダッシュボードと CLI から、あとからでも完結する。
            報告は作業ブランチに属し、記録はローカルの状態に依存しない。
            ずれ(検証後に積まれたコミット)と取り込み待ち(提出済みなのに未取り込み)は
            導出で常時カードに表示される
          </StatusRow>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          この画面は言語定義の人間向けの説明で、言語の変更と一緒に更新される。
        </p>
      </section>
    </div>
  );
}

function RoleLane({
  name,
  verb,
  accent,
  children,
}: {
  name: string;
  verb: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={`p-3.5 ${accent ? "border border-blue-500/40" : ""}`}>
      <h3 className="text-[14px] font-semibold">{name}</h3>
      <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{verb}</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</p>
    </Card>
  );
}

function LaneArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-1 text-zinc-400 sm:flex-col dark:text-zinc-500">
      <span className="text-[10px]">{label}</span>
      <span aria-hidden className="hidden sm:block">→</span>
      <span aria-hidden className="sm:hidden">↓</span>
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

// 正式名と識別子は概念の台帳(words.ts の CONCEPTS)から引く。この表が持つのは一言説明だけ
function Word({ id, children }: { id: ConceptId; children: React.ReactNode }) {
  const c = CONCEPTS[id];
  return (
    <tr className="border-b border-black/5 last:border-b-0 dark:border-white/5">
      <td className="px-4 py-2 font-semibold whitespace-nowrap">{c.ja}</td>
      <td className="px-4 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">{c.en}</td>
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
