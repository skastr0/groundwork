import {
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  resolveBoundedNumber,
} from "../args.ts";
import { runProcessText } from "../../../shared/effect-runtime.ts";
import type { CreateStateToolsOptions } from "../state/internal.ts";
import type {
  TreeCommitActivity,
  TreeScopeType,
} from "./schemas.ts";
import {
  TREE_COMMIT_ACTIVITY_DETECTION_METHOD,
  TREE_HISTORY_PARSE_MAX_OUTPUT_BYTES,
} from "./tree-types.ts";

type CommitActivityOptions = {
  shell: CreateStateToolsOptions["shell"];
  scope: TreeScopeType;
  anchorPath: string;
  baseRef: string | null;
  limit: number | undefined;
};

function unavailableCommitActivity(
  options: CommitActivityOptions,
  boundedLimit: number,
): TreeCommitActivity {
  return {
    range: null,
    available: false,
    count: 0,
    commits: [],
    bounds: {
      requested: options.limit,
      limit: boundedLimit,
      returned: 0,
      truncated: false,
    },
    detectionMethod: TREE_COMMIT_ACTIVITY_DETECTION_METHOD,
    hints: [
      `Commit activity is unavailable for ${options.scope} scope because the base ref could not be resolved.`,
    ],
  };
}

function parseCommitLog(logRaw: string): TreeCommitActivity["commits"] {
  return logRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, shortCommit, authorName, authoredAt, summary] = line.split("\u001f");
      if (!commit || !shortCommit || !authorName || !authoredAt || !summary) {
        return null;
      }

      return {
        commit,
        shortCommit,
        authorName,
        authoredAt,
        summary,
      };
    })
    .filter((value): value is TreeCommitActivity["commits"][number] => value !== null);
}

async function loadCommitActivityRaw(options: {
  shell: CreateStateToolsOptions["shell"];
  range: string;
  pathSpec: string;
  boundedLimit: number;
}): Promise<{ countRaw: string; logRaw: string }> {
  const [countRaw, logRaw] = await Promise.all([
    runProcessText({
      shell: options.shell,
      cmd: ["git", "rev-list", "--count", options.range, "--", options.pathSpec],
      maxOutputBytes: TREE_HISTORY_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    }),
    runProcessText({
      shell: options.shell,
      cmd: [
        "git",
        "log",
        "-n",
        String(options.boundedLimit),
        `--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s`,
        options.range,
        "--",
        options.pathSpec,
      ],
      maxOutputBytes: TREE_HISTORY_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    }),
  ]);

  return { countRaw, logRaw };
}

export async function loadCommitActivity(
  options: CommitActivityOptions,
): Promise<TreeCommitActivity> {
  const boundedLimit = resolveBoundedNumber(options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const pathSpec = options.anchorPath === "." ? "." : options.anchorPath;

  if (!options.baseRef) {
    return unavailableCommitActivity(options, boundedLimit);
  }

  const range = `${options.baseRef}..HEAD`;
  const { countRaw, logRaw } = await loadCommitActivityRaw({
    shell: options.shell,
    range,
    pathSpec,
    boundedLimit,
  });
  const count = Number.parseInt(countRaw.trim() || "0", 10) || 0;
  const commits = parseCommitLog(logRaw);
  const truncated = count > commits.length;

  return {
    range,
    available: true,
    count,
    commits,
    bounds: {
      requested: options.limit,
      limit: boundedLimit,
      returned: commits.length,
      truncated,
    },
    detectionMethod: TREE_COMMIT_ACTIVITY_DETECTION_METHOD,
    hints: truncated ? [`Commit activity truncated to ${commits.length}/${count} commit(s).`] : [],
  };
}
