import path from "node:path";
import { z } from "zod";
import { attachProcessRunner } from "../shared/effect-runtime.ts";
import {
  createFrameworkProvenanceTools,
  FRAMEWORK_PROVENANCE_TOOL_IDS,
  type FrameworkProvenanceToolID,
} from "./registry.ts";

export const PROVENANCE_CLI_COMMANDS: Record<string, FrameworkProvenanceToolID> = {
  "repo-state": "gw_repo_state",
  "file-state": "gw_file_state",
  "span-history": "gw_span_history",
  "diff-expand": "gw_diff_expand",
  "commit-materialize": "gw_commit_materialize",
  "commit-expand": "gw_commit_expand",
  "pr-materialize": "gw_pr_materialize",
  "pr-expand": "gw_pr_expand",
  "tree-expand": "gw_tree_expand",
  "worktree-overview": "gw_worktree_overview",
  hotspots: "gw_hotspots",
  authority: "gw_authority",
  "stability-report": "gw_stability_report",
  read: "gw_read",
  "block-read": "gw_block_read",
};

export { FRAMEWORK_PROVENANCE_TOOL_IDS };
export type { FrameworkProvenanceToolID };

export async function runProvenanceTool(input: {
  tool: FrameworkProvenanceToolID;
  root_dir?: string;
  args?: Record<string, unknown>;
}) {
  const rootDir = path.resolve(input.root_dir ?? process.cwd());
  const tools = createFrameworkProvenanceTools({
    shell: attachProcessRunner({}, { cwd: rootDir }) as never,
    rootDir,
  });
  const definition = tools[input.tool];
  if (!definition) {
    throw new Error(`Unknown provenance tool '${input.tool}'.`);
  }
  const parsedArgs = definition.args ? definitionArgParser(definition.args, input.args ?? {}) : {};
  const raw = await definition.execute(parsedArgs, createCliToolContext(rootDir));
  return parseToolResult(raw);
}

export function isProvenanceToolID(value: string): value is FrameworkProvenanceToolID {
  return (FRAMEWORK_PROVENANCE_TOOL_IDS as readonly string[]).includes(value);
}

function definitionArgParser(args: Record<string, unknown>, value: Record<string, unknown>) {
  return z.object(args as never).parse(value);
}

function parseToolResult(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function createCliToolContext(rootDir: string): unknown {
  return {
    sessionID: "groundwork-cli",
    messageID: "groundwork-cli",
    agent: "groundwork-cli",
    directory: rootDir,
    worktree: rootDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  };
}
