import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { attachEvidence } from "../ios/tools/attach_evidence.js";
import { openReport } from "../ios/tools/open_report.js";
import { registerBuild } from "../ios/tools/register_build.js";
import { CHECK_KINDS } from "../ios/words.js";
import { evidenceFilePath, overview, repoDetail } from "./api.js";

// ゲートはマシンに1プロセス(単一プロセスなので状態の書き込みは直列)。
// セッションごとの状態は持たない: 全ツールが対象を明示引数で受ける。

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
  const server = new McpServer({ name: "claude-gate", version: "0.8.0" });

  server.registerTool(
    "ping",
    { description: "ゲートの生存確認。プロセス ID を返す" },
    async () => asContent({ status: "ok", state: { pid: process.pid }, nextSteps: ["register_build"] }),
  );

  server.registerTool(
    "open_report",
    {
      description:
        "報告を開く。作業名と動作一覧(動くと言っている動作 + 使う確かめ方)を宣言する。動作一覧が空の報告は作れない。同じ作業名の再呼び出しはべき等(動作一覧はオープン時に固定)",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス"),
        title: z.string().describe("作業名(日本語の日常語。例「時間帯あいさつ+日付表示」)"),
        behaviors: z
          .array(
            z.object({
              behavior: z.string().describe("動くと言っている動作(文で書く)"),
              check: z
                .enum(CHECK_KINDS)
                .describe(
                  "使う確かめ方(語彙固定): compile=コンパイル / unit_test=ユニットテスト / screenshot=スクショ / interaction_log=操作記録 / ui_test=UIテスト / video=録画 / launch_check=起動確認 / human_check=人間確認",
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
        "証拠を付ける。受理前にシミュレータ内の実物からビルドID を計算し直し、登録済みの ID と照合する。別のビルドなら受け取らない",
      inputSchema: {
        worksitePath: z.string().describe("作業場(worktree)のパス"),
        buildId: z.string().describe("register_build が返したビルドID"),
        kind: z.enum(["screenshot", "ui_snapshot", "video"]),
        file: z.string().describe("観測ファイル(スクショ・録画)のパス"),
        simulatorUdid: z.string(),
        bundleId: z.string(),
        note: z.string().optional().describe("何を観測したか"),
        reportId: z.string().optional().describe("紐づける報告(open_report が返した reportId。behaviorIndex とセット)"),
        behaviorIndex: z.number().int().optional().describe("紐づける動作の番号(open_report が返す 1 始まり)"),
      },
    },
    async (args) => asReply(() => attachEvidence(args)),
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "claude-gate", version: "0.8.0", pid: process.pid });
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

// --- ダッシュボード(人間向け・読み取り専用) ---

app.get("/api/overview", (_req, res) => {
  res.json(overview());
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
const dashboardDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dashboard", "dist");
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
