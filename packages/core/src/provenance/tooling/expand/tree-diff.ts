import path from "node:path";
import { Effect } from "effect";
import {
  readFileStringEffect,
  runProcessText,
} from "../../../shared/effect-runtime.ts";
import type { CreateStateToolsOptions } from "../state/internal.ts";
import {
  getCanonicalPath,
  getOldPath,
  parseUnifiedDiff,
  type ParsedDiffSection,
} from "./diff-parser.ts";
import type { TreeScopeType } from "./schemas.ts";
import {
  toNormalizedPath,
} from "./shared.ts";
import {
  comparePaths,
  TREE_CHANGE_DETECTION_METHODS,
  TREE_DIFF_PARSE_MAX_OUTPUT_BYTES,
  type MatchedSection,
  type ScopedTreeSections,
} from "./tree-types.ts";
import { isPathWithinAnchor } from "./tree-anchor.ts";

type TreeDiffShell = CreateStateToolsOptions["shell"];

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

export function toMatchedSections(
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
      const rawText = await Effect.runPromise(readFileStringEffect(absolutePath));
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

export async function loadScopedSections(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  anchorPath: string;
  scope: TreeScopeType;
  baseRef: string | null;
}): Promise<ScopedTreeSections> {
  const pathSpec = options.anchorPath === "." ? "." : options.anchorPath;

  if (options.scope === "branch") {
    return loadBranchScopedSections({
      shell: options.shell,
      baseRef: options.baseRef,
      pathSpec,
    });
  }

  if (options.scope === "staged") {
    return loadStagedScopedSections({ shell: options.shell, pathSpec });
  }

  return loadWorkingTreeScopedSections({
    rootDir: options.rootDir,
    shell: options.shell,
    pathSpec,
  });
}

async function loadBranchScopedSections(options: {
  shell: TreeDiffShell;
  baseRef: string | null;
  pathSpec: string;
}): Promise<ScopedTreeSections> {
  if (!options.baseRef) {
    return {
      sections: [],
      changeDetectionMethod: TREE_CHANGE_DETECTION_METHODS.branch,
      warnings: [
        {
          code: "TREE_SCOPE_BASE_UNAVAILABLE",
          message:
            "Branch-scoped tree expansion requires a resolved base ref; changed-file summaries are unavailable.",
          ambiguity: "medium",
        },
      ],
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
      options.pathSpec,
    ],
    maxOutputBytes: TREE_DIFF_PARSE_MAX_OUTPUT_BYTES,
    trim: false,
  });
  return toScopedTreeSections(diffText, TREE_CHANGE_DETECTION_METHODS.branch);
}

async function loadStagedScopedSections(options: {
  shell: TreeDiffShell;
  pathSpec: string;
}): Promise<ScopedTreeSections> {
  const diffText = await runProcessText({
    shell: options.shell,
    cmd: ["git", "diff", "--cached", "--find-renames", "--unified=0", "--", options.pathSpec],
    maxOutputBytes: TREE_DIFF_PARSE_MAX_OUTPUT_BYTES,
    trim: false,
  });
  return toScopedTreeSections(diffText, TREE_CHANGE_DETECTION_METHODS.staged);
}

async function loadWorkingTreeScopedSections(options: {
  rootDir: string;
  shell: TreeDiffShell;
  pathSpec: string;
}): Promise<ScopedTreeSections> {
  const diffText = await createWorkingTreeDiffText({
    shell: options.shell,
    rootDir: options.rootDir,
    pathSpec: options.pathSpec,
  });
  return toScopedTreeSections(diffText, TREE_CHANGE_DETECTION_METHODS.working_tree);
}

function toScopedTreeSections(
  diffText: string,
  changeDetectionMethod: string,
): ScopedTreeSections {
  return {
    sections: parseUnifiedDiff(diffText),
    changeDetectionMethod,
    warnings: [],
  };
}
