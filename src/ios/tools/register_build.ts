import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { appendEvent } from "../../kernel/audit.js";
import { readJson, repoDirOf, writeJson } from "../../kernel/store.js";
import { buildIdOf, shortBuildId } from "../build_id.js";
import { gitDirty, gitSha } from "../git.js";
import { machoUuidsOf } from "../macho_uuid.js";
import type { Build, Reply } from "../words.js";

export interface RegisterBuildArgs {
  worksitePath: string;
  appPath: string;
  scheme?: string;
  configuration?: string;
}

export interface RegisterBuildDeps {
  machoUuidsOf: (appPath: string) => string[];
}

const defaultDeps: RegisterBuildDeps = { machoUuidsOf };

export function registerBuild(args: RegisterBuildArgs, deps: RegisterBuildDeps = defaultDeps): Reply<Build> {
  const gateDir = repoDirOf(args.worksitePath);

  if (!existsSync(args.appPath) || !statSync(args.appPath).isDirectory() || !args.appPath.endsWith(".app")) {
    const reason = `appPath が .app ディレクトリではない: ${args.appPath}`;
    appendEvent(gateDir, { tool: "register_build", result: "rejected", reason });
    return {
      status: "rejected",
      reason,
      fix: "XcodeBuildMCP のビルド結果(structured output の data.artifacts.appPath)をそのまま渡してください",
      nextSteps: ["register_build"],
    };
  }

  const buildIdFull = buildIdOf(args.appPath);
  const buildId = shortBuildId(buildIdFull);
  const recordPath = join(gateDir, "builds", `${buildId}.json`);

  const existing = readJson<Build>(recordPath);
  if (existing !== null) {
    appendEvent(gateDir, { tool: "register_build", result: "ok", buildId, alreadyRegistered: true });
    return {
      status: "ok",
      state: existing,
      note: `既登録のビルド(登録: ${existing.registeredAt})。記録の gitSha / dirty は最初の登録時のもの`,
      nextSteps: ["attach_evidence"],
    };
  }

  const build: Build = {
    buildId,
    buildIdFull,
    appPath: args.appPath,
    gitSha: gitSha(args.worksitePath),
    dirty: gitDirty(args.worksitePath),
    machoUuids: deps.machoUuidsOf(args.appPath),
    scheme: args.scheme,
    configuration: args.configuration,
    registeredAt: new Date().toISOString(),
  };
  writeJson(recordPath, build);
  appendEvent(gateDir, { tool: "register_build", result: "ok", buildId });
  return { status: "ok", state: build, nextSteps: ["attach_evidence"] };
}
