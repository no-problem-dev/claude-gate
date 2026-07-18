import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { attachEvidence } from "../ios/tools/attach_evidence.js";
import { registerBuild } from "../ios/tools/register_build.js";

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
  const server = new McpServer({ name: "claude-gate", version: "0.1.0" });

  server.registerTool(
    "ping",
    { description: "ゲートの生存確認。プロセス ID を返す" },
    async () => asContent({ status: "ok", state: { pid: process.pid }, nextSteps: ["register_build"] }),
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
      },
    },
    async (args) => asReply(() => attachEvidence(args)),
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "claude-gate", version: "0.1.0", pid: process.pid });
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

const port = Number(process.env.GATE_PORT ?? 7350);
app.listen(port, "127.0.0.1", () => {
  console.log(`claude-gate listening on http://127.0.0.1:${port}`);
});
