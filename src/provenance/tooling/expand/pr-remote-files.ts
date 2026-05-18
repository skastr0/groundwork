import {
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
} from "../args.ts";
import { parseJsonResult, runGhText } from "./pr-gh.ts";
import type {
  GhPrFile,
  PrToolName,
} from "./pr-types.ts";
import type {
  PrChangedFile,
  PrRemoteFiles,
} from "./schemas.ts";
import type { CreateStateToolsOptions } from "../state/index.ts";

const REMOTE_STATUS_MAP: Record<string, PrChangedFile["status"]> = {
  added: "added",
  modified: "modified",
  changed: "modified",
  removed: "deleted",
  renamed: "renamed",
  copied: "copied",
};

function normalizeRemoteStatus(status: string): PrChangedFile["status"] {
  return REMOTE_STATUS_MAP[status] ?? "unknown";
}

function toRemoteChangedFile(file: GhPrFile): PrChangedFile {
  return {
    path: file.filename,
    previousPath: file.previous_filename,
    status: normalizeRemoteStatus(file.status),
    additions: Math.max(0, Math.trunc(file.additions ?? 0)),
    deletions: Math.max(0, Math.trunc(file.deletions ?? 0)),
  };
}

export async function resolveRemoteFiles(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  prNumber: number;
  limit: number | undefined;
}): Promise<PrRemoteFiles> {
  const command = `gh api --paginate repos/:owner/:repo/pulls/${options.prNumber}/files`;
  const result = await runGhText({
    shell: options.shell,
    toolName: options.toolName,
    command,
    cmd: ["gh", "api", "--paginate", `repos/:owner/:repo/pulls/${options.prNumber}/files`],
  });

  if (!result.success) {
    return {
      status: "unavailable",
      code: result.failure.code,
      message: result.failure.message,
    };
  }

  const parsed = parseJsonResult<GhPrFile[]>(
    result.data,
    `pull request #${options.prNumber} files`,
  );
  if (!parsed.success) {
    return {
      status: "unavailable",
      code: parsed.failure.code,
      message: parsed.failure.message,
    };
  }

  const allFiles = parsed.data.map((file) => toRemoteChangedFile(file));
  const bounded = applyBoundedLimit(allFiles, options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);

  return {
    status: "available",
    totalFiles: allFiles.length,
    items: bounded.items,
    bounds: bounded.bounds,
  };
}
