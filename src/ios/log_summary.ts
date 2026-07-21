// check_run(確かめの実行ログ)の要約。ダッシュボードで「何が起きたか」を一行で見せるために、
// ログ末尾のサマリ行を抽出する。純関数(テスト対象)。
//
// 抽出は終了コードで駆動する。理由: 複数パッケージを && で連結した swift test では、
// 先に通ったパッケージが "✔ Test run with N tests passed" を出した後で別パッケージが
// クラッシュすることがある。末尾から「passed」を素朴に拾うと、失敗なのに成功行を拾う。
// そこで exitCode=0 なら成功マーカー、非0 なら失敗マーカーだけを末尾から探す。

const MAX_HEADLINE = 200;

// 失敗行のハイライト判定(Lightbox のログ表示で使う)にも使う共通パターン
export const ERROR_LINE_RE =
  /(\*\* (?:BUILD|TEST|CLEAN|ARCHIVE|ANALYZE|INSTALL) FAILED \*\*|\berror:|✘|unexpected signal code \d+|\bsignal (?:code )?\d+\b|Fatal error|fatalError|Segmentation fault|\bcrashed\b|with [1-9]\d* (?:issue|failure))/;

export function isErrorLine(line: string): boolean {
  return ERROR_LINE_RE.test(line);
}

// ログと終了コードから一行の見出しを作る。抽出できなければ末尾の非空行にフォールバック
export function checkRunHeadline(log: string, exitCode: number): string {
  const nonEmpty = log.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return "(出力なし)";

  const scan = (re: RegExp): string | null => {
    for (let i = nonEmpty.length - 1; i >= 0; i--) {
      if (re.test(nonEmpty[i])) return nonEmpty[i].trim();
    }
    return null;
  };

  const found =
    exitCode === 0
      ? scan(/\*\* (?:BUILD|TEST|CLEAN|ARCHIVE|ANALYZE|INSTALL) SUCCEEDED \*\*/) ??
        scan(/Test run with \d+ tests?\b.*\bpassed\b/) ??
        scan(/Executed \d+ tests?, with 0 failures/) ??
        scan(/Test Suite .+ passed\b/) ??
        scan(/Build complete!/)
      : scan(/\*\* (?:BUILD|TEST|CLEAN|ARCHIVE|ANALYZE|INSTALL) FAILED \*\*/) ??
        scan(/Test run with \d+ tests?\b.*(?:\bfailed\b|\d+ (?:issue|failure))/) ??
        scan(/Executed \d+ tests?, with [1-9]\d* failures?/) ??
        scan(/unexpected signal code \d+|\bsignal (?:code )?\d+\b/) ??
        scan(/Fatal error|fatalError|Segmentation fault|\bcrashed\b/) ??
        scan(/\berror:/);

  const headline = found ?? nonEmpty[nonEmpty.length - 1];
  return headline.length > MAX_HEADLINE ? `${headline.slice(0, MAX_HEADLINE)}…` : headline;
}
