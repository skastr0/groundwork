import { runProcessText } from "../../../../shared/effect-runtime.ts";
import { applyBoundedLimit, DEFAULT_PROVENANCE_ITEM_LIMIT } from "../args.ts";
import {
  resolveLocalFileState,
  resolveLocalRepoState,
  toProvFileStateData,
  toProvRepoStateData,
  type CreateStateToolsOptions,
  type LocalFileState,
  type LocalRepoState,
} from "../state/index.ts";
import { toDiffChangeSummary, toNearbyFileSummary } from "./change-summaries.ts";
import {
  getCanonicalPath,
  parseUnifiedDiff,
  sectionMatchesPaths,
  type ParsedDiffSection,
} from "./diff-parser.ts";
import type {
  ChangeContextKey,
  DiffChangeSummary,
  NearbyFileSummary,
  ProvDiffExpandData,
} from "./schemas.ts";

const FILE_ANCHOR_DIFF_PARSE_MAX_OUTPUT_BYTES = 256_000;

type FileComparisonKey = Extract<
  ChangeContextKey,
  "base_to_head" | "head_to_index" | "index_to_worktree"
>;

type LoadedComparisonDiff = {
  comparison: {
    key: FileComparisonKey;
    fromRef: string;
    toRef: string;
    paths: string[];
  };
  sections: ParsedDiffSection[];
  matchedSection?: ParsedDiffSection;
};

export type FileAnchorResolution = {
  repoState: LocalRepoState;
  fileState: LocalFileState;
  data: ProvDiffExpandData;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled comparison key: ${String(value)}`);
}

async function readComparisonDiff(options: {
  shell: CreateStateToolsOptions["shell"];
  key: FileComparisonKey;
  fromRef: string;
  toRef: string;
}): Promise<string> {
  switch (options.key) {
    case "base_to_head":
      return runProcessText({
        shell: options.shell,
        cmd: [
          "git",
          "diff",
          "--find-renames",
          "--unified=0",
          `${options.fromRef}..${options.toRef}`,
          "--",
          ".",
        ],
        maxOutputBytes: FILE_ANCHOR_DIFF_PARSE_MAX_OUTPUT_BYTES,
        trim: false,
      });
    case "head_to_index":
      return runProcessText({
        shell: options.shell,
        cmd: ["git", "diff", "--cached", "--find-renames", "--unified=0", "--", "."],
        maxOutputBytes: FILE_ANCHOR_DIFF_PARSE_MAX_OUTPUT_BYTES,
        trim: false,
      });
    case "index_to_worktree":
      return runProcessText({
        shell: options.shell,
        cmd: ["git", "diff", "--find-renames", "--unified=0", "--", "."],
        maxOutputBytes: FILE_ANCHOR_DIFF_PARSE_MAX_OUTPUT_BYTES,
        trim: false,
      });
  }

  return assertNever(options.key);
}

function buildComparisonContexts(
  fileState: LocalFileState,
): Array<LoadedComparisonDiff["comparison"]> {
  const comparisons = [
    {
      key: "base_to_head" as const,
      fromRef: fileState.comparisons.baseToHead.fromRef,
      toRef: fileState.comparisons.baseToHead.toRef,
      paths: [fileState.comparisons.baseToHead.fromPath, fileState.comparisons.baseToHead.toPath],
      detected: fileState.comparisons.baseToHead.detected,
      changed: fileState.comparisons.baseToHead.status !== "unchanged",
    },
    {
      key: "head_to_index" as const,
      fromRef: fileState.comparisons.headToIndex.fromRef,
      toRef: fileState.comparisons.headToIndex.toRef,
      paths: [fileState.comparisons.headToIndex.fromPath, fileState.comparisons.headToIndex.toPath],
      detected: fileState.comparisons.headToIndex.detected,
      changed: fileState.comparisons.headToIndex.status !== "unchanged",
    },
    {
      key: "index_to_worktree" as const,
      fromRef: fileState.comparisons.indexToWorktree.fromRef,
      toRef: fileState.comparisons.indexToWorktree.toRef,
      paths: [
        fileState.comparisons.indexToWorktree.fromPath,
        fileState.comparisons.indexToWorktree.toPath,
      ],
      detected: fileState.comparisons.indexToWorktree.detected,
      changed: fileState.comparisons.indexToWorktree.status !== "unchanged",
    },
  ];

  return comparisons
    .filter((comparison) => comparison.changed || comparison.detected)
    .map(({ key, fromRef, toRef, paths }) => ({ key, fromRef, toRef, paths }));
}

async function loadComparisonDiffs(
  shell: CreateStateToolsOptions["shell"],
  comparisons: Array<LoadedComparisonDiff["comparison"]>,
): Promise<LoadedComparisonDiff[]> {
  return await Promise.all(
    comparisons.map(async (comparison) => {
      const sections = parseUnifiedDiff(
        await readComparisonDiff({
          shell,
          key: comparison.key,
          fromRef: comparison.fromRef,
          toRef: comparison.toRef,
        }),
      );

      return {
        comparison,
        sections,
        matchedSection: sections.find((section) => sectionMatchesPaths(section, comparison.paths)),
      };
    }),
  );
}

function buildFileAnchorChanges(options: {
  diffs: LoadedComparisonDiff[];
  limit: number | undefined;
  maxBytes: number | undefined;
  includePatch: boolean;
}): DiffChangeSummary[] {
  return options.diffs.flatMap((diff) =>
    diff.matchedSection
      ? [
          toDiffChangeSummary({
            key: diff.comparison.key,
            fromRef: diff.comparison.fromRef,
            toRef: diff.comparison.toRef,
            section: diff.matchedSection,
            limit: options.limit,
            maxBytes: options.maxBytes,
            includePatch: options.includePatch,
          }),
        ]
      : [],
  );
}

function buildFileAnchorNearbyFiles(diffs: LoadedComparisonDiff[]): NearbyFileSummary[] {
  const deduped = new Map<string, NearbyFileSummary>();

  for (const diff of diffs) {
    for (const section of diff.sections) {
      if (
        diff.matchedSection &&
        getCanonicalPath(section) === getCanonicalPath(diff.matchedSection)
      ) {
        continue;
      }

      const summary = toNearbyFileSummary({
        key: diff.comparison.key,
        fromRef: diff.comparison.fromRef,
        toRef: diff.comparison.toRef,
        section,
      });
      const key = `${summary.key}:${summary.path}`;
      if (!deduped.has(key)) {
        deduped.set(key, summary);
      }
    }
  }

  return [...deduped.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export async function resolveFileAnchorDiff(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  requestedPath: string;
  base: string | undefined;
  limit: number | undefined;
  maxBytes: number | undefined;
  includePatch: boolean;
}): Promise<FileAnchorResolution> {
  const [repoState, fileState] = await Promise.all([
    resolveLocalRepoState({ shell: options.shell, explicitBase: options.base }),
    resolveLocalFileState({
      shell: options.shell,
      requestedPath: options.requestedPath,
      explicitBase: options.base,
    }),
  ]);
  const comparisonDiffs = await loadComparisonDiffs(
    options.shell,
    buildComparisonContexts(fileState),
  );
  const changeCandidates = buildFileAnchorChanges({
    diffs: comparisonDiffs,
    limit: options.limit,
    maxBytes: options.maxBytes,
    includePatch: options.includePatch,
  });
  const nearbyCandidates = buildFileAnchorNearbyFiles(comparisonDiffs);
  const changeSummaries = applyBoundedLimit(
    changeCandidates,
    options.limit,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  const nearbyFiles = applyBoundedLimit(
    nearbyCandidates,
    options.limit,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  return {
    repoState,
    fileState,
    data: {
      anchor: {
        kind: "file",
        requestedPath: options.requestedPath,
        resolvedPath: fileState.resolvedPath,
        mappedPaths: [...new Set(changeCandidates.map((change) => change.path))],
      },
      repo: toProvRepoStateData(repoState, options.limit),
      file: toProvFileStateData(fileState),
      changeSummaries: changeSummaries.items,
      nearbyFiles: nearbyFiles.items,
      bounds: {
        changeSummaries: changeSummaries.bounds,
        nearbyFiles: nearbyFiles.bounds,
      },
    },
  };
}
