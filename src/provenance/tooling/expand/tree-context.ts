import {
  DEFAULT_PROVENANCE_DEPTH_LIMIT,
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
  resolveBoundedNumber,
} from "../args.ts";
import {
  resolveLocalRepoState,
  toProvRepoStateData,
  type CreateStateToolsOptions,
} from "../state/index.ts";
import type {
  ProvTreeExpandData,
  TreeAreaSummary,
  TreeCommitActivity,
  TreeFileSummary,
} from "./schemas.ts";
import { resolveTreeAnchor } from "./tree-anchor.ts";
import {
  buildAreaSummaries,
  mergeTreeFiles,
  summarizeCheckout,
} from "./tree-aggregation.ts";
import { loadCommitActivity } from "./tree-commits.ts";
import {
  loadScopedSections,
  toMatchedSections,
} from "./tree-diff.ts";
import type {
  TreeExpandAssembly,
  TreeExpandCoreArgs,
  TreeExpandLoadContext,
} from "./tree-types.ts";

async function loadTreeExpandContext(
  options: CreateStateToolsOptions,
  args: TreeExpandCoreArgs,
): Promise<TreeExpandLoadContext> {
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

  return {
    rootDir,
    scope,
    maxDepth,
    anchor,
    repoState,
    scopedSections,
  };
}

async function assembleTreeFilesAndAreas(
  context: TreeExpandLoadContext,
): Promise<{
  files: TreeFileSummary[];
  areas: TreeAreaSummary[];
}> {
  const files = mergeTreeFiles(
    toMatchedSections(context.scopedSections.sections, context.anchor.resolvedPath),
  );
  const areas = await buildAreaSummaries({
    rootDir: context.rootDir,
    anchorPath: context.anchor.resolvedPath,
    maxDepth: context.maxDepth,
    files,
    indexFiles: context.repoState.index.files,
    worktreeFiles: context.repoState.worktree.files,
    untrackedFiles: context.repoState.untracked.files,
  });

  return {
    files,
    areas,
  };
}

function buildTreeExpandSummaryData(options: {
  anchorPath: string;
  areas: readonly TreeAreaSummary[];
  files: readonly TreeFileSummary[];
  commits: TreeCommitActivity;
  repoState: TreeExpandLoadContext["repoState"];
}): ProvTreeExpandData["summary"] {
  return {
    areas: options.areas.length,
    changedFiles: options.files.length,
    additions: options.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: options.files.reduce((sum, file) => sum + file.deletions, 0),
    commits: options.commits.count,
    checkout: summarizeCheckout({
      anchorPath: options.anchorPath,
      indexFiles: options.repoState.index.files,
      worktreeFiles: options.repoState.worktree.files,
      untrackedFiles: options.repoState.untracked.files,
    }),
  };
}

async function assembleTreeExpandData(
  options: CreateStateToolsOptions,
  args: TreeExpandCoreArgs,
  context: TreeExpandLoadContext,
): Promise<TreeExpandAssembly> {
  const { areas, files } = await assembleTreeFilesAndAreas(context);
  const fileBounds = applyBoundedLimit(files, args.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const areaBounds = applyBoundedLimit(areas, args.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const commits = await loadCommitActivity({
    shell: options.shell,
    scope: context.scope,
    anchorPath: context.anchor.resolvedPath,
    baseRef: context.repoState.base.ref,
    limit: args.limit,
  });

  return {
    summary: buildTreeExpandSummaryData({
      anchorPath: context.anchor.resolvedPath,
      areas,
      files,
      commits,
      repoState: context.repoState,
    }),
    areas: areaBounds.items,
    files: fileBounds.items,
    commits,
    bounds: {
      areas: areaBounds.bounds,
      files: fileBounds.bounds,
    },
  };
}

function buildTreeExpandData(
  args: TreeExpandCoreArgs,
  context: TreeExpandLoadContext,
  assembly: TreeExpandAssembly,
): ProvTreeExpandData {
  return {
    anchor: {
      requestedPath: context.anchor.requestedPath,
      resolvedPath: context.anchor.resolvedPath,
      kind: context.anchor.kind,
    },
    scope: {
      type: context.scope,
      branchName: context.repoState.currentBranch.name,
      baseRef: context.repoState.base.ref,
      baseDetectionMethod: context.repoState.base.detectionMethod,
      changeDetectionMethod: context.scopedSections.changeDetectionMethod,
    },
    repo: toProvRepoStateData(context.repoState, args.limit),
    summary: assembly.summary,
    areas: assembly.areas,
    files: assembly.files,
    commits: assembly.commits,
    bounds: assembly.bounds,
  };
}

export async function resolveTreeExpandCore(
  options: CreateStateToolsOptions,
  args: TreeExpandCoreArgs,
): Promise<{
  data: ProvTreeExpandData;
  warnings: TreeExpandLoadContext["anchor"]["warnings"];
}> {
  const context = await loadTreeExpandContext(options, args);
  const assembly = await assembleTreeExpandData(options, args, context);
  const data = buildTreeExpandData(args, context, assembly);

  return {
    data,
    warnings: [...context.anchor.warnings, ...context.scopedSections.warnings],
  };
}
