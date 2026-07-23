import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { RUNNABLE_CHECKS } from "../ios/gate_yaml.js";
import { attachEvidence } from "../ios/tools/attach_evidence.js";
import { judge } from "../ios/tools/judge.js";
import { openReport } from "../ios/tools/open_report.js";
import { registerBuild } from "../ios/tools/register_build.js";
import { runCheck } from "../ios/tools/run_check.js";
import { submit } from "../ios/tools/submit.js";
import { CHANGE_KINDS, CHECK_KINDS } from "../ios/words.js";
import { confirmBehavior, confirmDelta } from "../ios/confirm.js";
import { deltaPreview, evidenceFilePath, overview, repoDetail, submittedRecord, worksitePathOf } from "./api.js";

// ゲートはマシンに1プロセス(単一プロセスなので状態の書き込みは直列)。
// セッションごとの状態は持たない: 全ツールが対象を明示引数で受ける。

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { version } = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { version: string };

const asContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const asReply = (run: () => unknown) => {
  try {
    return asContent(run());
  } catch (error) {
    return asContent({
      status: "rejected",
      reason: String(error),
      fix: "worksitePath が git リポジトリ内を指しているか確認してください",
      nextSteps: ["ping"],
    });
  }
};

function newServer(): McpServer {
  const server = new McpServer({ name: "claude-gate", version });

  server.registerTool(
    "ping",
    { description: "ゲートの生存確認。プロセス ID を返す" },
    async () => asContent({ status: "ok", state: { pid: process.pid }, nextSteps: ["register_build"] }),
  );

  server.registerTool(
    "open_report",
    {
      description:
        "報告を開く。作業名と動作一覧(動くと言っている動作 + 変更の種類 + 使う確かめ方)を宣言する。動作一覧が空の報告、確かめ方が変更の種類の合格ラインを下回る計画は作れない。同じ作業名の再呼び出しはべき等(動作一覧はオープン時に固定)",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス"),
        title: z.string().describe("作業名(日本語の日常語。例「時間帯あいさつ+日付表示」)"),
        behaviors: z
          .array(
            z.object({
              behavior: z.string().describe("動くと言っている動作(文で書く)"),
              change_kind: z
                .enum(CHANGE_KINDS)
                .describe(
                  "変更の種類(語彙固定): logic=ロジック / appearance=見た目 / interaction=操作・遷移 / motion=動き / data=データ / contract=契約 / config=設定 / system=連携",
                ),
              check: z
                .enum(CHECK_KINDS)
                .describe(
                  "使う確かめ方(語彙固定): compile=コンパイル / unit_test=ユニットテスト / screenshot=スクショ / interaction_log=操作記録 / ui_test=UIテスト / video=録画 / launch_check=起動確認 / device_report=実機レポート(実機で走ったアプリのセルフレポート。keychain 復元・課金・通知配信・上書き更新 E2E 等 実機でしか確認できない動作) / human_check=人間確認。変更の種類ごとに使える確かめ方が決まっている(下回ると拒否)",
                ),
            }),
          )
          .describe("動作一覧 + 確かめ計画。並び順が番号(1始まり)になる"),
      },
    },
    async (args) => asReply(() => openReport(args)),
  );

  server.registerTool(
    "register_build",
    {
      description:
        "ビルドを登録する。appPath(.app)の中身からビルドID を計算して記録する。同じビルドの再登録は同じレコードを返す(べき等)",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス。状態の置き場をここから解決する"),
        appPath: z.string().describe("ビルド成果物 .app のパス(XcodeBuildMCP の data.artifacts.appPath)"),
        scheme: z.string().optional(),
        configuration: z.string().optional(),
      },
    },
    async (args) => asReply(() => registerBuild(args)),
  );

  server.registerTool(
    "attach_evidence",
    {
      description:
        "証拠を付ける。シミュレータ観測(screenshot / ui_snapshot / video)は受理前にシミュレータ内の実物からビルドID を計算し直して照合する。実機レポート(device_report)は実機から .app を取れないので、レポート本文の buildUUID を登録ビルドの Mach-O UUID と照合する。別のビルドなら受け取らない",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス"),
        buildId: z.string().describe("register_build が返したビルドID"),
        kind: z
          .enum(["screenshot", "ui_snapshot", "video", "device_report"])
          .describe(
            "証拠の種類。device_report=実機で走ったアプリのセルフレポート(buildUUID= 行を含む console 出力等)。それ以外はシミュレータ観測",
          ),
        file: z.string().describe("観測ファイル(スクショ・録画・実機レポートのテキスト)のパス"),
        simulatorUdid: z.string().optional().describe("シミュレータ観測で必須(観測したシミュレータの UDID)"),
        deviceUdid: z.string().optional().describe("device_report で必須(レポートを回収した実機の UDID)"),
        bundleId: z.string(),
        note: z.string().optional().describe("何を観測したか"),
        reportId: z.string().optional().describe("紐づける報告(open_report が返した reportId。behaviorIndex とセット)"),
        behaviorIndex: z.number().int().optional().describe("紐づける動作の番号(open_report が返す 1 始まり)"),
      },
    },
    async (args) => asReply(() => attachEvidence(args)),
  );

  server.registerTool(
    "run_check",
    {
      description:
        "確かめを実行する。リポジトリの gate.yaml の checks に宣言されたコマンドをゲート自身が実行し、終了コードと出力を証拠(check_run)として記録する。テスト系(compile / unit_test / ui_test)の確かめは自己申告ではなくこの操作で証拠化する",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス。コマンドはここを cwd に実行される"),
        check: z.enum(RUNNABLE_CHECKS).describe("実行する確かめ方(gate.yaml の checks に宣言が必要)"),
        reportId: z.string().optional().describe("紐づける報告(behaviorIndex とセット)"),
        behaviorIndex: z.number().int().optional().describe("紐づける動作の番号(1始まり)"),
      },
    },
    async (args) => asReply(() => runCheck(args)),
  );

  server.registerTool(
    "judge",
    {
      description:
        "判定する。報告の全動作が受理済み証拠で覆われているかをゲートが決定論で照合し、合格 / 不合格 / 確認できず を決める(動かしたエージェント自身は判定しない)。確認できず は人間に渡す正式な出口",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス"),
        reportId: z.string().describe("判定する報告(open_report が返した reportId)"),
      },
    },
    async (args) => asReply(() => judge(args)),
  );

  server.registerTool(
    "submit",
    {
      description:
        "提出する。検証と人間確認が終わった合格報告を「検証したソース(sourceSha)を受け入れた」と記録する。記録だけの状態遷移で、git や gh のコマンドは実行しない。提出済みの記録があると、取り込みに向かう操作(gh pr ready 等)が hook のガードを通るようになる。共有(feature ブランチへの push・下書きPR の作成)は自由、merge とデフォルトブランチへの push は人間だけ。合格していない報告は提出できない。提出済みの報告は終着(証拠の追加も不可)",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス"),
        reportId: z.string().describe("提出する報告(合格している必要がある)"),
      },
    },
    async (args) => asReply(() => submit(args)),
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "claude-gate", version, pid: process.pid });
});

app.post("/mcp", async (req, res) => {
  const server = newServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// --- ダッシュボード(人間向け。読み取り + 人間確認の記録だけ) ---

app.get("/api/overview", (_req, res) => {
  res.json(overview());
});

// 消費者向けの照会(読み取り専用): このリポジトリのこの sha に一致する提出済みの報告があるか。
// PreToolUse hook がレビュー可能化(gh pr ready)の前にブランチ先端の sha で問い合わせる。
// 台帳もディレクトリも作らない(照会は状態を増やさない)
app.get("/api/submitted", (req, res) => {
  const { path, sha } = req.query as Record<string, unknown>;
  if (typeof path !== "string" || typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    res.status(400).json({ submitted: false, error: "引数が足りない(path / sha=完全な40桁のコミットID)" });
    return;
  }
  res.json(submittedRecord(path, sha));
});

// 人間確認の記録(人間の操作面はダッシュボードと CLI の2つ。同じ confirmBehavior に合流し、べき等)。
// エージェントの語彙(MCP)には入れない。ローカル HTTP は機械的には誰でも呼べる —
// 防御は語彙の境界 + スキルの禁止 + 監査(via: dashboard が記録に残る)で、forget/confirm CLI と同じ信頼層
app.post("/api/confirm", (req, res) => {
  const { repoKey, reportId, behaviorIndex, note } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof repoKey !== "string" ||
    !/^[0-9a-f]{12}$/.test(repoKey) ||
    typeof reportId !== "string" ||
    !Number.isInteger(behaviorIndex) ||
    typeof note !== "string"
  ) {
    res.status(400).json({
      status: "rejected",
      reason: "引数が足りない(repoKey / reportId / behaviorIndex / note)",
      fix: "ダッシュボードの人間確認フォームから記録してください",
    });
    return;
  }
  const worksitePath = worksitePathOf(repoKey);
  if (worksitePath === null) {
    res.status(404).json({
      status: "rejected",
      reason: "リポジトリの実体が見つからない(台帳に無いか、ディレクトリが消えている)",
      fix: "リポジトリのチェックアウトがあるマシンで記録してください",
    });
    return;
  }
  res.json(
    confirmBehavior({
      worksitePath,
      report: reportId,
      behaviorIndex: behaviorIndex as number,
      note,
      via: "dashboard",
    }),
  );
});

// 提出の記録(人間がダッシュボードから)。条件はエージェント経由と同一(合格していること) —
// 提出は記録だけで git・GitHub への書き込みを含まない(入口が違うだけで門は同じ。監査に via: dashboard が残る)
app.post("/api/submit", (req, res) => {
  const { repoKey, reportId } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof repoKey !== "string" || !/^[0-9a-f]{12}$/.test(repoKey) || typeof reportId !== "string") {
    res.status(400).json({
      status: "rejected",
      reason: "引数が足りない(repoKey / reportId)",
      fix: "ダッシュボードの提出ボタンから実行してください",
    });
    return;
  }
  const worksitePath = worksitePathOf(repoKey);
  if (worksitePath === null) {
    res.status(404).json({
      status: "rejected",
      reason: "リポジトリの実体が見つからない(台帳に無いか、ディレクトリが消えている)",
      fix: "リポジトリのチェックアウトがあるマシンで提出してください",
    });
    return;
  }
  res.json(submit({ worksitePath, reportId, via: "dashboard" }));
});

// 差分確認の判断材料(読み取り): 検証したソースと HEAD のずれ(コミット一覧)。
// 何を引き受けるのかを見せずに引き受けさせない
app.get("/api/repos/:repoKey/reports/:reportId/delta", (req, res) => {
  const preview = deltaPreview(req.params.repoKey, req.params.reportId);
  if ("error" in preview) {
    res.status(404).json(preview);
    return;
  }
  res.json(preview);
});

// 差分確認の記録(人間の操作。confirm と同じ信頼層 — MCP には入れない・監査に via: dashboard が残る)。
// toSha は判断材料として表示した sha をそのまま渡す(見たものと記録するものを一致させる)
app.post("/api/confirm-delta", (req, res) => {
  const { repoKey, reportId, toSha, note } = (req.body ?? {}) as Record<string, unknown>;
  if (
    typeof repoKey !== "string" ||
    !/^[0-9a-f]{12}$/.test(repoKey) ||
    typeof reportId !== "string" ||
    typeof toSha !== "string" ||
    typeof note !== "string"
  ) {
    res.status(400).json({
      status: "rejected",
      reason: "引数が足りない(repoKey / reportId / toSha / note)",
      fix: "ダッシュボードの差分確認フォームから記録してください",
    });
    return;
  }
  const worksitePath = worksitePathOf(repoKey);
  if (worksitePath === null) {
    res.status(404).json({
      status: "rejected",
      reason: "リポジトリの実体が見つからない(台帳に無いか、ディレクトリが消えている)",
      fix: "リポジトリのチェックアウトがあるマシンで記録してください",
    });
    return;
  }
  res.json(confirmDelta({ worksitePath, report: reportId, toSha, note, via: "dashboard" }));
});

app.get("/api/repos/:repoKey", (req, res) => {
  const detail = repoDetail(req.params.repoKey);
  if (detail === null) {
    res.status(404).json({ error: "unknown repo" });
    return;
  }
  res.json(detail);
});

app.get("/api/evidence/:repoKey/:evidenceId/file", (req, res) => {
  const path = evidenceFilePath(req.params.repoKey, req.params.evidenceId);
  if (path === null) {
    res.status(404).json({ error: "unknown evidence" });
    return;
  }
  res.sendFile(path);
});

// ビルド済みダッシュボード(dashboard/dist)を / で配信する
const dashboardDist = join(rootDir, "dashboard", "dist");
if (existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/mcp")) return next();
    res.sendFile(join(dashboardDist, "index.html"));
  });
}

const port = Number(process.env.GATE_PORT ?? 7350);
app.listen(port, "127.0.0.1", () => {
  console.log(`claude-gate listening on http://127.0.0.1:${port}`);
});
