import path from "node:path";
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import {
  pathExists as checkPathExists,
  readFileString,
  runProcessText,
  statPath,
} from "../../../../shared/effect-runtime.ts";
import {
  DEFAULT_PROVENANCE_DEPTH_LIMIT,
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
  createBoundedNumberArg,
  provenanceBaseArg,
  provenanceMaxBytesArg,
  provenanceMaxDepthArg,
  provenanceMaxItemsArg,
  provenanceModeArg,
  provenancePathArg,
  provenanceScopeArg,
  resolveBoundedNumber,
} from "../args.ts";
import {
  createProvenanceSuccess,
  type ProvenanceEvidenceSource,
  type ProvenanceWarning,
} from "../contracts.ts";
import {
  normalizeCreateStateToolsOptions,
  resolveLocalRepoState,
  toProvRepoStateData,
  type CreateStateToolsOptions,
  type LocalRepoFileStatus,
  type LocalRepoFileStatusKind,
} from "../state/index.ts";
import { logger } from "../utils/logger.ts";
import { toNearbyFileSummary } from "./change-summaries.ts";
import {
  getCanonicalPath,
  getOldPath,
  parseUnifiedDiff,
  type ParsedDiffSection,
} from "./diff-parser.ts";
import { buildLinkedEvidence } from "./evidence.ts";
import {
  PROV_TREE_EXPAND_TOOL,
  PROV_WORKTREE_OVERVIEW_TOOL,
  type ProvTreeExpandData,
  type ProvWorktreeOverviewData,
  type TreeAreaKind,
  type TreeAreaSummary,
  type TreeCheckoutSummary,
  type TreeCommitActivity,
  type TreeFileSummary,
  type TreeScopeType,
  type TreeStatusBreakdown,
} from "./schemas.ts";
import { createToolFailure, resolveLocalMode } from "./tool-support.ts";
import {
  dedupeWarnings,
  getHighestAmbiguity,
  getLowestConfidence,
  toErrorMessage,
  toNormalizedPath,
} from "./shared.ts";

const TREE_DIFF_PARSE_MAX_OUTPUT_BYTES = 384_000;
const TREE_HISTORY_PARSE_MAX_OUTPUT_BYTES = 256_000;

const TREE_CHANGE_DETECTION_METHODS: Record<TreeScopeType, string> = {
  branch: "git diff --find-renames --unified=0 <base-ref>..HEAD -- <path>",
  staged: "git diff --cached --find-renames --unified=0 -- <path>",
  working_tree:
    "git diff --find-renames --unified=0 -- <path> + git diff --cached --find-renames --unified=0 -- <path> + synthetic untracked patches",
};

const TREE_COMMIT_ACTIVITY_DETECTION_METHOD =
  "git rev-list --count <base-ref>..HEAD -- <path> + git log -n --format <base-ref>..HEAD -- <path>";

const AREA_SAMPLE_PATH_LIMIT = 3;

const STATUS_PRIORITY: Record<LocalRepoFileStatusKind, number> = {
  unknown: 0,
  modified: 1,
  added: 2,
  deleted: 3,
  copied: 4,
  renamed: 5,
};

const treeSummaryLimitArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_ITEM_LIMIT,
  description: "Max area, file, and commit summaries to return",
});

type ResolvedTreeAnchor = {
  requestedPath: string;
  resolvedPath: string;
  kind: TreeAreaKind;
  warnings: ProvenanceWarning[];
};

type MatchedSection = {
  section: ParsedDiffSection;
  matchedPath: string;
};

type MutableAreaSummary = {
  path: string;
  depth: number;
  kind: TreeAreaKind;
  changedFiles: number;
  additions: number;
  deletions: number;
  statuses: TreeStatusBreakdown;
  checkout: TreeCheckoutSummary;
  samplePaths: Set<string>;
};

function createStatusBreakdown(): TreeStatusBreakdown {
  return {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    unknown: 0,
  };
}

function createCheckoutSummary(): TreeCheckoutSummary {
  return {
    staged: 0,
    unstaged: 0,
    untracked: 0,
  };
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeAnchorPath(requestedPath: string, rootDir: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new Error("Path must not be empty.");
  }

  if (trimmed === "." || trimmed === "./") {
    return ".";
  }

  if (!path.isAbsolute(trimmed)) {
    const normalized = toNormalizedPath(path.normalize(trimmed));
    return normalized.length > 0 && normalized !== "." ? normalized : ".";
  }

  const relative = path.relative(rootDir, trimmed);
  if (!relative) {
    return ".";
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path '${trimmed}' is outside worktree '${rootDir}'.`);
  }

  return toNormalizedPath(relative);
}

function resolveAnchorAbsolutePath(rootDir: string, resolvedPath: string): string {
  return resolvedPath === "." ? rootDir : path.join(rootDir, resolvedPath);
}

async function detectAreaKind(rootDir: string, relativePath: string): Promise<TreeAreaKind> {
  if (relativePath === ".") {
    return "root";
  }

  const packageJsonPath = path.join(
    resolveAnchorAbsolutePath(rootDir, relativePath),
    "package.json",
  );
  return (await checkPathExists(packageJsonPath)) ? "package" : "directory";
}

async function resolveTreeAnchor(options: {
  rootDir: string;
  requestedPath: string;
}): Promise<ResolvedTreeAnchor> {
  const requestedPath = options.requestedPath.trim();
  const normalizedPath = normalizeAnchorPath(requestedPath, options.rootDir);
  const absolutePath = resolveAnchorAbsolutePath(options.rootDir, normalizedPath);

  let stats: Awaited<ReturnType<typeof statPath>>;
  try {
    stats = await statPath(absolutePath);
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(`Tree anchor '${requestedPath}' is unavailable: ${message}`);
  }

  if (stats.isDirectory()) {
    return {
      requestedPath,
      resolvedPath: normalizedPath,
      kind: await detectAreaKind(options.rootDir, normalizedPath),
      warnings: [],
    };
  }

  if (!stats.isFile()) {
    throw new Error(`Tree anchor '${requestedPath}' must resolve to a directory or file.`);
  }

  const parentPath = path.dirname(normalizedPath);
  const resolvedPath = parentPath === "." ? "." : toNormalizedPath(parentPath);

  return {
    requestedPath,
    resolvedPath,
    kind: await detectAreaKind(options.rootDir, resolvedPath),
    warnings: [
      {
        code: "TREE_ANCHOR_FILE_RESOLVED_TO_PARENT",
        message: `Tree anchor '${requestedPath}' resolved to parent directory '${resolvedPath}'.`,
        ambiguity: "low",
      },
    ],
  };
}

function isPathWithinAnchor(targetPath: string, anchorPath: string): boolean {
  const normalizedPath = toNormalizedPath(targetPath);
  if (!normalizedPath) {
    return false;
  }

  if (anchorPath === ".") {
    return true;
  }

  return normalizedPath === anchorPath || normalizedPath.startsWith(`${anchorPath}/`);
}

function getMatchedPath(section: ParsedDiffSection, anchorPath: string): string | null {
  const canonicalPath = getCanonicalPath(section);
  if (isPathWithinAnchor(canonicalPath, anchorPath)) {
    return canonicalPath;
  }

  const oldPath = getOldPath(section);
  if (oldPath && isPathWithinAnchor(oldPath, anchorPath)) {
    return oldPath;
  }

  return null;
}

function toMatchedSections(
  sections: readonly ParsedDiffSection[],
  anchorPath: string,
): MatchedSection[] {
  return sections
    .map((section) => {
      const matchedPath = getMatchedPath(section, anchorPath);
      return matchedPath ? { section, matchedPath } : null;
    })
    .filter((value): value is MatchedSection => value !== null);
}

function buildSyntheticUntrackedPatch(relativePath: string, rawText: string): string {
  const normalizedPath = toNormalizedPath(relativePath);
  const normalizedContent = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalizedContent.split("\n");
  if (normalizedContent.endsWith("\n")) {
    lines.pop();
  }

  const header = [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${normalizedPath}`,
  ];

  if (lines.length === 0) {
    return `${header.join("\n")}\n`;
  }

  const hunkHeader = `@@ -0,0 +1,${lines.length} @@`;
  const body = lines.map((line) => `+${line}`).join("\n");
  return `${header.join("\n")}\n${hunkHeader}\n${body}\n`;
}

async function createWorkingTreeDiffText(options: {
  rootDir: string;
  shell: CreateStateToolsOptions["shell"];
  pathSpec: string;
}): Promise<string> {
  const [unstagedDiff, stagedDiff, untrackedRaw] = await Promise.all([
    runProcessText({
      shell: options.shell,
      cmd: ["git", "diff", "--find-renames", "--unified=0", "--", options.pathSpec],
      maxOutputBytes: TREE_DIFF_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    }),
    runProcessText({
      shell: options.shell,
      cmd: ["git", "diff", "--cached", "--find-renames", "--unified=0", "--", options.pathSpec],
      maxOutputBytes: TREE_DIFF_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    }),
    runProcessText({
      shell: options.shell,
      cmd: ["git", "ls-files", "--others", "--exclude-standard", "--", options.pathSpec],
      trim: false,
    }),
  ]);

  const untrackedFiles = untrackedRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort(comparePaths);

  const untrackedDiffs = await Promise.all(
    untrackedFiles.map(async (relativePath) => {
      const absolutePath = path.join(options.rootDir, relativePath);
      const rawText = await readFileString(absolutePath);
      return buildSyntheticUntrackedPatch(relativePath, rawText);
    }),
  );

  const sections = [
    unstagedDiff.trim(),
    stagedDiff.trim(),
    ...untrackedDiffs.map((diff) => diff.trim()),
  ]
    .filter((value) => value.length > 0)
    .join("\n\n");

  return sections.length > 0 ? `${sections}\n` : "";
}

async function loadScopedSections(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  anchorPath: string;
  scope: TreeScopeType;
  baseRef: string | null;
}): Promise<{
  sections: ParsedDiffSection[];
  changeDetectionMethod: string;
  warnings: ProvenanceWarning[];
}> {
  const pathSpec = options.anchorPath === "." ? "." : options.anchorPath;
  const warnings: ProvenanceWarning[] = [];

  if (options.scope === "branch") {
    if (!options.baseRef) {
      warnings.push({
        code: "TREE_SCOPE_BASE_UNAVAILABLE",
        message:
          "Branch-scoped tree expansion requires a resolved base ref; changed-file summaries are unavailable.",
        ambiguity: "medium",
      });

      return {
        sections: [],
        changeDetectionMethod: TREE_CHANGE_DETECTION_METHODS.branch,
        warnings,
      };
    }

    const diffText = await runProcessText({
      shell: options.shell,
      cmd: [
        "git",
        "diff",
        "--find-renames",
        "--unified=0",
        `${options.baseRef}..HEAD`,
        "--",
        pathSpec,
      ],
      maxOutputBytes: TREE_DIFF_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    });
    return {
      sections: parseUnifiedDiff(diffText),
      changeDetectionMethod: TREE_CHANGE_DETECTION_METHODS.branch,
      warnings,
    };
  }

  if (options.scope === "staged") {
    const diffText = await runProcessText({
      shell: options.shell,
      cmd: ["git", "diff", "--cached", "--find-renames", "--unified=0", "--", pathSpec],
      maxOutputBytes: TREE_DIFF_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    });
    return {
      sections: parseUnifiedDiff(diffText),
      changeDetectionMethod: TREE_CHANGE_DETECTION_METHODS.staged,
      warnings,
    };
  }

  const diffText = await createWorkingTreeDiffText({
    rootDir: options.rootDir,
    shell: options.shell,
    pathSpec,
  });
  return {
    sections: parseUnifiedDiff(diffText),
    changeDetectionMethod: TREE_CHANGE_DETECTION_METHODS.working_tree,
    warnings,
  };
}

function mergeTreeFiles(matches: readonly MatchedSection[]): TreeFileSummary[] {
  const merged = new Map<string, TreeFileSummary>();

  for (const match of matches) {
    const next = {
      ...toNearbyFileSummary({
        key: "artifact",
        fromRef: null,
        toRef: null,
        section: match.section,
      }),
      matchedPath: match.matchedPath,
    } satisfies TreeFileSummary;
    const key = next.matchedPath;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, next);
      continue;
    }

    const nextPriority = STATUS_PRIORITY[next.status];
    const existingPriority = STATUS_PRIORITY[existing.status];
    merged.set(key, {
      key: existing.key,
      fromRef: existing.fromRef,
      toRef: existing.toRef,
      path: nextPriority >= existingPriority ? next.path : existing.path,
      oldPath: existing.oldPath ?? next.oldPath,
      status: nextPriority >= existingPriority ? next.status : existing.status,
      additions: existing.additions + next.additions,
      deletions: existing.deletions + next.deletions,
      hunkCount: existing.hunkCount + next.hunkCount,
      matchedPath: existing.matchedPath,
    });
  }

  return [...merged.values()].sort((left, right) => {
    const leftChurn = left.additions + left.deletions;
    const rightChurn = right.additions + right.deletions;
    if (rightChurn !== leftChurn) {
      return rightChurn - leftChurn;
    }

    const leftPriority = STATUS_PRIORITY[left.status];
    const rightPriority = STATUS_PRIORITY[right.status];
    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }

    return left.matchedPath.localeCompare(right.matchedPath);
  });
}

function deriveAreaPath(filePath: string, anchorPath: string, maxDepth: number): string {
  const normalized = toNormalizedPath(filePath);
  const relative = anchorPath === "." ? normalized : path.posix.relative(anchorPath, normalized);
  const relativeDir = path.posix.dirname(relative);
  if (relativeDir === ".") {
    return anchorPath;
  }

  const segments = relativeDir.split("/").filter(Boolean);
  const boundedSegments = segments.slice(0, Math.min(maxDepth, segments.length));
  if (anchorPath === ".") {
    return boundedSegments.join("/");
  }

  return toNormalizedPath(path.posix.join(anchorPath, ...boundedSegments));
}

function areaDepth(areaPath: string, anchorPath: string): number {
  if (areaPath === anchorPath) {
    return 0;
  }

  const relative = anchorPath === "." ? areaPath : path.posix.relative(anchorPath, areaPath);
  return relative.split("/").filter(Boolean).length;
}

function areaSort(left: TreeAreaSummary, right: TreeAreaSummary): number {
  if (right.changedFiles !== left.changedFiles) {
    return right.changedFiles - left.changedFiles;
  }

  const leftChurn = left.additions + left.deletions;
  const rightChurn = right.additions + right.deletions;
  if (rightChurn !== leftChurn) {
    return rightChurn - leftChurn;
  }

  const leftCheckout = left.checkout.staged + left.checkout.unstaged + left.checkout.untracked;
  const rightCheckout = right.checkout.staged + right.checkout.unstaged + right.checkout.untracked;
  if (rightCheckout !== leftCheckout) {
    return rightCheckout - leftCheckout;
  }

  return left.path.localeCompare(right.path);
}

async function buildAreaSummaries(options: {
  rootDir: string;
  anchorPath: string;
  maxDepth: number;
  files: readonly TreeFileSummary[];
  indexFiles: readonly LocalRepoFileStatus[];
  worktreeFiles: readonly LocalRepoFileStatus[];
  untrackedFiles: readonly string[];
}): Promise<TreeAreaSummary[]> {
  const areaMap = new Map<string, MutableAreaSummary>();

  const getOrCreateArea = async (areaPath: string): Promise<MutableAreaSummary> => {
    const existing = areaMap.get(areaPath);
    if (existing) {
      return existing;
    }

    const next: MutableAreaSummary = {
      path: areaPath,
      depth: areaDepth(areaPath, options.anchorPath),
      kind: await detectAreaKind(options.rootDir, areaPath),
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      statuses: createStatusBreakdown(),
      checkout: createCheckoutSummary(),
      samplePaths: new Set<string>(),
    };
    areaMap.set(areaPath, next);
    return next;
  };

  for (const file of options.files) {
    const areaPath = deriveAreaPath(file.matchedPath, options.anchorPath, options.maxDepth);
    const area = await getOrCreateArea(areaPath);
    area.changedFiles += 1;
    area.additions += file.additions;
    area.deletions += file.deletions;
    area.statuses[file.status] += 1;
    area.samplePaths.add(file.matchedPath);
  }

  const applyCheckoutBucket = async (
    bucket: keyof TreeCheckoutSummary,
    filePaths: readonly string[],
  ): Promise<void> => {
    for (const filePath of filePaths) {
      if (!isPathWithinAnchor(filePath, options.anchorPath)) {
        continue;
      }

      const areaPath = deriveAreaPath(filePath, options.anchorPath, options.maxDepth);
      const area = areaMap.get(areaPath);
      if (!area) {
        continue;
      }

      area.checkout[bucket] += 1;
    }
  };

  await Promise.all([
    applyCheckoutBucket(
      "staged",
      options.indexFiles.map((file) => toNormalizedPath(file.newPath ?? file.path)),
    ),
    applyCheckoutBucket(
      "unstaged",
      options.worktreeFiles.map((file) => toNormalizedPath(file.newPath ?? file.path)),
    ),
    applyCheckoutBucket(
      "untracked",
      options.untrackedFiles.map((filePath) => toNormalizedPath(filePath)),
    ),
  ]);

  return [...areaMap.values()]
    .map((area) => ({
      path: area.path,
      kind: area.kind,
      depth: area.depth,
      changedFiles: area.changedFiles,
      additions: area.additions,
      deletions: area.deletions,
      statuses: area.statuses,
      checkout: area.checkout,
      samplePaths: [...area.samplePaths].sort(comparePaths).slice(0, AREA_SAMPLE_PATH_LIMIT),
    }))
    .sort(areaSort);
}

function summarizeCheckout(options: {
  anchorPath: string;
  indexFiles: readonly LocalRepoFileStatus[];
  worktreeFiles: readonly LocalRepoFileStatus[];
  untrackedFiles: readonly string[];
}): TreeCheckoutSummary {
  return {
    staged: options.indexFiles.filter((file) =>
      isPathWithinAnchor(toNormalizedPath(file.newPath ?? file.path), options.anchorPath),
    ).length,
    unstaged: options.worktreeFiles.filter((file) =>
      isPathWithinAnchor(toNormalizedPath(file.newPath ?? file.path), options.anchorPath),
    ).length,
    untracked: options.untrackedFiles.filter((filePath) =>
      isPathWithinAnchor(toNormalizedPath(filePath), options.anchorPath),
    ).length,
  };
}

async function loadCommitActivity(options: {
  shell: CreateStateToolsOptions["shell"];
  scope: TreeScopeType;
  anchorPath: string;
  baseRef: string | null;
  limit: number | undefined;
}): Promise<TreeCommitActivity> {
  const boundedLimit = resolveBoundedNumber(options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const pathSpec = options.anchorPath === "." ? "." : options.anchorPath;

  if (!options.baseRef) {
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

  const range = `${options.baseRef}..HEAD`;
  const [countRaw, logRaw] = await Promise.all([
    runProcessText({
      shell: options.shell,
      cmd: ["git", "rev-list", "--count", range, "--", pathSpec],
      maxOutputBytes: TREE_HISTORY_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    }),
    runProcessText({
      shell: options.shell,
      cmd: [
        "git",
        "log",
        "-n",
        String(boundedLimit),
        `--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s`,
        range,
        "--",
        pathSpec,
      ],
      maxOutputBytes: TREE_HISTORY_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    }),
  ]);

  const count = Number.parseInt(countRaw.trim() || "0", 10) || 0;
  const commits = logRaw
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

function toEvidenceSources(
  items: ReadonlyArray<ProvTreeExpandData["evidence"]["items"][number]>,
): ProvenanceEvidenceSource[] {
  return items.map((item) => ({
    kind: item.kind,
    id: item.id,
    path: item.path,
    label: item.label,
    detail: item.detail,
    ref: item.timestamp,
  }));
}

function buildTreeSources(data: ProvTreeExpandData): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: `tree:${data.anchor.resolvedPath}`,
      path: data.anchor.resolvedPath,
      label: `${data.anchor.kind} anchor`,
      detail: `${data.summary.changedFiles} changed file(s) in ${data.scope.type} scope`,
    },
  ];

  if (data.commits.available && data.commits.range) {
    sources.push({
      kind: "git",
      id: `tree-commits:${data.commits.range}`,
      ref: data.commits.range,
      label: "commit activity",
      detail: `${data.commits.count} commit(s)`,
    });
  }

  return [...sources, ...toEvidenceSources(data.evidence.items)];
}

function buildWorktreeOverviewSources(data: ProvWorktreeOverviewData): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: `worktree:${data.scope.type}`,
      ref: data.scope.baseRef ?? data.scope.type,
      label: "worktree overview",
      detail: `${data.summary.changedFiles} changed file(s), ${data.summary.focusAreas} focus area(s)`,
    },
  ];

  if (data.commits.available && data.commits.range) {
    sources.push({
      kind: "git",
      id: `worktree-commits:${data.commits.range}`,
      ref: data.commits.range,
      label: "commit activity",
      detail: `${data.commits.count} commit(s)`,
    });
  }

  return [...sources, ...toEvidenceSources(data.evidence.items)];
}

function collectTreeWarnings(data: {
  scope: TreeScopeType;
  summary: ProvTreeExpandData["summary"];
  bounds: ProvTreeExpandData["bounds"];
  commits: TreeCommitActivity;
  evidence: ProvTreeExpandData["evidence"];
  warnings: ProvenanceWarning[];
}): ProvenanceWarning[] {
  const output = [...data.warnings];

  if (data.summary.changedFiles === 0) {
    output.push({
      code: "TREE_SCOPE_EMPTY",
      message: `No changed files matched the requested ${data.scope} scope.`,
      ambiguity: "low",
    });
  }

  if (data.bounds.areas.truncated) {
    output.push({
      code: "TREE_AREAS_TRUNCATED",
      message: `Tree area summaries were truncated to ${data.bounds.areas.returned} item(s).`,
      ambiguity: "low",
    });
  }

  if (data.bounds.files.truncated) {
    output.push({
      code: "TREE_FILES_TRUNCATED",
      message: `Tree file summaries were truncated to ${data.bounds.files.returned} item(s).`,
      ambiguity: "low",
    });
  }

  if (!data.commits.available) {
    output.push({
      code: "TREE_COMMIT_ACTIVITY_UNAVAILABLE",
      message: data.commits.hints[0] ?? "Commit activity is unavailable for the requested scope.",
      ambiguity: data.scope === "branch" ? "medium" : "low",
    });
  }

  if (data.commits.bounds.truncated) {
    output.push({
      code: "TREE_COMMITS_TRUNCATED",
      message: `Commit activity was truncated to ${data.commits.bounds.returned}/${data.commits.count} commit(s).`,
      ambiguity: "low",
    });
  }

  if (data.evidence.bounds.truncated) {
    output.push({
      code: "EVIDENCE_ITEMS_TRUNCATED",
      message: `Linked evidence was truncated to ${data.evidence.bounds.returned} ranked item(s).`,
      ambiguity: "low",
    });
  }

  if (data.evidence.bytes.truncated) {
    output.push({
      code: "EVIDENCE_BYTES_TRUNCATED",
      message: `Linked evidence summaries hit the ${data.evidence.bytes.limit}-byte budget.`,
      ambiguity: "low",
    });
  }

  return dedupeWarnings(output);
}

async function resolveTreeExpandCore(
  options: CreateStateToolsOptions,
  args: {
    path: string;
    base?: string;
    scope?: TreeScopeType;
    limit?: number;
    max_items?: number;
    max_bytes?: number;
    max_depth?: number;
  },
): Promise<{ data: ProvTreeExpandData; warnings: ProvenanceWarning[] }> {
  const rootDir = options.rootDir ?? process.cwd();
  const scope = args.scope ?? "branch";
  const maxDepth = resolveBoundedNumber(args.max_depth, DEFAULT_PROVENANCE_DEPTH_LIMIT);
  const anchor = await resolveTreeAnchor({
    rootDir,
    requestedPath: args.path,
  });
  const repoState = await resolveLocalRepoState({
    shell: options.shell,
    explicitBase: args.base,
  });
  const scopedSections = await loadScopedSections({
    shell: options.shell,
    rootDir,
    anchorPath: anchor.resolvedPath,
    scope,
    baseRef: repoState.base.ref,
  });
  const files = mergeTreeFiles(toMatchedSections(scopedSections.sections, anchor.resolvedPath));
  const areas = await buildAreaSummaries({
    rootDir,
    anchorPath: anchor.resolvedPath,
    maxDepth,
    files,
    indexFiles: repoState.index.files,
    worktreeFiles: repoState.worktree.files,
    untrackedFiles: repoState.untracked.files,
  });
  const fileBounds = applyBoundedLimit(files, args.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const areaBounds = applyBoundedLimit(areas, args.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const commits = await loadCommitActivity({
    shell: options.shell,
    scope,
    anchorPath: anchor.resolvedPath,
    baseRef: repoState.base.ref,
    limit: args.limit,
  });
  const evidence = await buildLinkedEvidence({
    rootDir,
    paths: files.flatMap(
      (file) => [file.matchedPath, file.path, file.oldPath].filter(Boolean) as string[],
    ),
    limit: args.limit,
    maxItems: args.max_items,
    maxBytes: args.max_bytes,
  });
  const summary = {
    areas: areas.length,
    changedFiles: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    commits: commits.count,
    evidenceItems: evidence.items.length,
    checkout: summarizeCheckout({
      anchorPath: anchor.resolvedPath,
      indexFiles: repoState.index.files,
      worktreeFiles: repoState.worktree.files,
      untrackedFiles: repoState.untracked.files,
    }),
  } satisfies ProvTreeExpandData["summary"];
  const data: ProvTreeExpandData = {
    anchor: {
      requestedPath: anchor.requestedPath,
      resolvedPath: anchor.resolvedPath,
      kind: anchor.kind,
    },
    scope: {
      type: scope,
      branchName: repoState.currentBranch.name,
      baseRef: repoState.base.ref,
      baseDetectionMethod: repoState.base.detectionMethod,
      changeDetectionMethod: scopedSections.changeDetectionMethod,
    },
    repo: toProvRepoStateData(repoState, args.limit),
    summary,
    areas: areaBounds.items,
    files: fileBounds.items,
    commits,
    evidence,
    bounds: {
      areas: areaBounds.bounds,
      files: fileBounds.bounds,
    },
  };
  const warnings = collectTreeWarnings({
    scope,
    summary,
    bounds: data.bounds,
    commits,
    evidence,
    warnings: [...anchor.warnings, ...scopedSections.warnings],
  });

  return {
    data,
    warnings,
  };
}

function toWorktreeOverviewData(data: ProvTreeExpandData): ProvWorktreeOverviewData {
  return {
    scope: data.scope,
    repo: data.repo,
    summary: {
      focusAreas: data.summary.areas,
      changedFiles: data.summary.changedFiles,
      additions: data.summary.additions,
      deletions: data.summary.deletions,
      commits: data.summary.commits,
      evidenceItems: data.summary.evidenceItems,
      checkout: data.summary.checkout,
    },
    focusAreas: data.areas,
    files: data.files,
    commits: data.commits,
    evidence: data.evidence,
    bounds: {
      focusAreas: data.bounds.areas,
      files: data.bounds.files,
    },
  };
}

function buildTreeExpandSummary(data: ProvTreeExpandData): string {
  const anchorLabel = data.anchor.resolvedPath === "." ? "repo root" : data.anchor.resolvedPath;
  return `Expanded ${anchorLabel} in ${data.scope.type} scope: ${data.summary.changedFiles} changed file(s), ${data.summary.areas} focus area(s), ${data.summary.commits} commit(s), ${data.summary.evidenceItems} linked evidence item(s).`;
}

function buildWorktreeOverviewSummary(data: ProvWorktreeOverviewData): string {
  return `Worktree overview for ${data.scope.type} scope: ${data.summary.changedFiles} changed file(s), ${data.summary.focusAreas} focus area(s), ${data.summary.checkout.staged} staged, ${data.summary.checkout.unstaged} unstaged, ${data.summary.checkout.untracked} untracked.`;
}

export function createTreeExpandTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Expand one directory or package path into bounded changed-file, focus-area, commit-activity, and linked-evidence summaries.",
    args: {
      path: provenancePathArg,
      base: provenanceBaseArg,
      scope: provenanceScopeArg,
      mode: provenanceModeArg,
      limit: treeSummaryLimitArg,
      max_items: provenanceMaxItemsArg,
      max_bytes: provenanceMaxBytesArg,
      max_depth: provenanceMaxDepthArg,
    },
    async execute(args) {
      const unsupported = resolveLocalMode(PROV_TREE_EXPAND_TOOL, args.mode);
      if (unsupported) {
        return unsupported;
      }

      logger.info("prov_tree_expand start", {
        tool: PROV_TREE_EXPAND_TOOL,
        path: args.path,
        base: args.base,
        scope: args.scope ?? "branch",
        limit: args.limit,
        maxItems: args.max_items,
        maxBytes: args.max_bytes,
        maxDepth: args.max_depth,
      });

      try {
        const resolved = await resolveTreeExpandCore(runtimeOptions, args);
        const response = createProvenanceSuccess({
          tool: PROV_TREE_EXPAND_TOOL,
          mode: "local",
          confidence: getLowestConfidence([
            resolved.data.repo.branch.confidence,
            resolved.data.summary.changedFiles > 0 ? "high" : "medium",
          ]),
          ambiguity: getHighestAmbiguity(
            resolved.warnings.map((warning) => warning.ambiguity ?? "low"),
          ),
          bounds: resolved.data.bounds.areas,
          summary: buildTreeExpandSummary(resolved.data),
          warnings: resolved.warnings,
          sources: buildTreeSources(resolved.data),
          data: resolved.data,
        });

        logger.info("prov_tree_expand end", {
          tool: PROV_TREE_EXPAND_TOOL,
          anchor: resolved.data.anchor.resolvedPath,
          scope: resolved.data.scope.type,
          changedFiles: resolved.data.summary.changedFiles,
          areas: resolved.data.summary.areas,
          commits: resolved.data.summary.commits,
          evidence: resolved.data.summary.evidenceItems,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("prov_tree_expand failed", {
          tool: PROV_TREE_EXPAND_TOOL,
          path: args.path,
          error: message,
        });
        return createToolFailure({
          tool: PROV_TREE_EXPAND_TOOL,
          summary: `Failed to expand tree anchor '${args.path}'.`,
          code: "TREE_EXPAND_FAILED",
          message,
        });
      }
    },
  });
}

export function createWorktreeOverviewTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Summarize the current local worktree into bounded focus areas, changed files, commit activity, and linked evidence.",
    args: {
      base: provenanceBaseArg,
      scope: provenanceScopeArg,
      mode: provenanceModeArg,
      limit: treeSummaryLimitArg,
      max_items: provenanceMaxItemsArg,
      max_bytes: provenanceMaxBytesArg,
      max_depth: provenanceMaxDepthArg,
    },
    async execute(args) {
      const unsupported = resolveLocalMode(PROV_WORKTREE_OVERVIEW_TOOL, args.mode);
      if (unsupported) {
        return unsupported;
      }

      logger.info("prov_worktree_overview start", {
        tool: PROV_WORKTREE_OVERVIEW_TOOL,
        base: args.base,
        scope: args.scope ?? "working_tree",
        limit: args.limit,
        maxItems: args.max_items,
        maxBytes: args.max_bytes,
        maxDepth: args.max_depth,
      });

      try {
        const resolved = await resolveTreeExpandCore(runtimeOptions, {
          path: ".",
          base: args.base,
          scope: args.scope ?? "working_tree",
          limit: args.limit,
          max_items: args.max_items,
          max_bytes: args.max_bytes,
          max_depth: args.max_depth,
        });
        const data = toWorktreeOverviewData(resolved.data);
        const response = createProvenanceSuccess({
          tool: PROV_WORKTREE_OVERVIEW_TOOL,
          mode: "local",
          confidence: getLowestConfidence([
            data.repo.branch.confidence,
            data.summary.changedFiles > 0 ? "high" : "medium",
          ]),
          ambiguity: getHighestAmbiguity(
            resolved.warnings.map((warning) => warning.ambiguity ?? "low"),
          ),
          bounds: data.bounds.focusAreas,
          summary: buildWorktreeOverviewSummary(data),
          warnings: resolved.warnings,
          sources: buildWorktreeOverviewSources(data),
          data,
        });

        logger.info("prov_worktree_overview end", {
          tool: PROV_WORKTREE_OVERVIEW_TOOL,
          scope: data.scope.type,
          changedFiles: data.summary.changedFiles,
          focusAreas: data.summary.focusAreas,
          staged: data.summary.checkout.staged,
          unstaged: data.summary.checkout.unstaged,
          untracked: data.summary.checkout.untracked,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("prov_worktree_overview failed", {
          tool: PROV_WORKTREE_OVERVIEW_TOOL,
          error: message,
        });
        return createToolFailure({
          tool: PROV_WORKTREE_OVERVIEW_TOOL,
          summary: "Failed to summarize the local worktree.",
          code: "WORKTREE_OVERVIEW_FAILED",
          message,
        });
      }
    },
  });
}
