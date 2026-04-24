import { LOCAL_REPO_FILE_STATUS_VALUES } from "../state/index.ts";
import type { PatchHunk } from "./schemas.ts";
import { toNormalizedPath } from "./shared.ts";

type SectionStatus = (typeof LOCAL_REPO_FILE_STATUS_VALUES)[number];

type SectionState = {
  oldPath: string;
  newPath: string;
  explicitStatus?: SectionStatus;
  additions: number;
  deletions: number;
  hunks: PatchHunk[];
  lines: string[];
};

type SectionBuilder = {
  appendLine: (line: string) => void;
  finalize: () => ParsedDiffSection | null;
};

export type ParsedDiffSection = {
  oldPath: string;
  newPath: string;
  status: SectionStatus;
  additions: number;
  deletions: number;
  hunks: PatchHunk[];
  patchText: string;
};

function normalizePatchPath(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (trimmed === "/dev/null") {
    return trimmed;
  }

  return toNormalizedPath(trimmed.replace(/^[ab]\//, ""));
}

function unescapeQuotedDiffPath(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function parseDiffGitHeader(line: string): { oldPath: string; newPath: string } | null {
  const quotedMatch = line.match(/^diff --git "a\/((?:[^"\\]|\\.)+)" "b\/((?:[^"\\]|\\.)+)"$/);
  if (quotedMatch?.[1] && quotedMatch[2]) {
    return {
      oldPath: normalizePatchPath(unescapeQuotedDiffPath(quotedMatch[1])),
      newPath: normalizePatchPath(unescapeQuotedDiffPath(quotedMatch[2])),
    };
  }

  const plainMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (plainMatch?.[1] && plainMatch[2]) {
    return {
      oldPath: normalizePatchPath(plainMatch[1]),
      newPath: normalizePatchPath(plainMatch[2]),
    };
  }

  return null;
}

function parseHunkHeader(line: string): PatchHunk | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/);
  if (!match?.[1] || !match[3]) {
    return null;
  }

  return {
    header: line,
    oldStart: Number.parseInt(match[1], 10),
    oldCount: Number.parseInt(match[2] ?? "1", 10),
    newStart: Number.parseInt(match[3], 10),
    newCount: Number.parseInt(match[4] ?? "1", 10),
    additions: 0,
    deletions: 0,
  };
}

function applyMetadataDirective(state: SectionState, line: string): boolean {
  if (line.startsWith("rename from ")) {
    state.oldPath = toNormalizedPath(line.slice("rename from ".length).trim());
    state.explicitStatus = "renamed";
    return true;
  }

  if (line.startsWith("rename to ")) {
    state.newPath = toNormalizedPath(line.slice("rename to ".length).trim());
    state.explicitStatus = "renamed";
    return true;
  }

  if (line.startsWith("copy from ")) {
    state.oldPath = toNormalizedPath(line.slice("copy from ".length).trim());
    state.explicitStatus = "copied";
    return true;
  }

  if (line.startsWith("copy to ")) {
    state.newPath = toNormalizedPath(line.slice("copy to ".length).trim());
    state.explicitStatus = "copied";
    return true;
  }

  if (line.startsWith("new file mode ")) {
    state.explicitStatus = "added";
    return true;
  }

  if (line.startsWith("deleted file mode ")) {
    state.explicitStatus = "deleted";
    return true;
  }

  if (line.startsWith("--- ")) {
    state.oldPath = normalizePatchPath(line.slice(4));
    return true;
  }

  if (line.startsWith("+++ ")) {
    state.newPath = normalizePatchPath(line.slice(4));
    return true;
  }

  return false;
}

function recordHunkLine(state: SectionState, line: string): void {
  const activeHunk = state.hunks.at(-1);
  if (!activeHunk) {
    return;
  }

  if (line.startsWith("+") && !line.startsWith("+++ ")) {
    activeHunk.additions += 1;
    state.additions += 1;
    return;
  }

  if (line.startsWith("-") && !line.startsWith("--- ")) {
    activeHunk.deletions += 1;
    state.deletions += 1;
  }
}

function inferSectionStatus(state: SectionState): SectionStatus {
  if (state.explicitStatus) {
    return state.explicitStatus;
  }

  if (state.oldPath === "/dev/null") {
    return "added";
  }

  if (state.newPath === "/dev/null") {
    return "deleted";
  }

  if (state.oldPath !== state.newPath) {
    return "renamed";
  }

  if (state.hunks.length > 0 || state.additions > 0 || state.deletions > 0) {
    return "modified";
  }

  return "unknown";
}

function finalizeSection(state: SectionState): ParsedDiffSection | null {
  if (!state.oldPath && !state.newPath) {
    return null;
  }

  const patchText = state.lines.join("\n").trimEnd();
  return {
    oldPath: state.oldPath,
    newPath: state.newPath,
    status: inferSectionStatus(state),
    additions: state.additions,
    deletions: state.deletions,
    hunks: [...state.hunks],
    patchText: patchText.length > 0 ? `${patchText}\n` : "",
  };
}

function createSectionBuilder(startLine: string): SectionBuilder {
  const header = parseDiffGitHeader(startLine);
  const state: SectionState = {
    oldPath: header?.oldPath ?? "",
    newPath: header?.newPath ?? "",
    additions: 0,
    deletions: 0,
    hunks: [],
    lines: [startLine],
  };

  return {
    appendLine(line) {
      state.lines.push(line);
      if (applyMetadataDirective(state, line)) {
        return;
      }

      const hunk = parseHunkHeader(line);
      if (hunk) {
        state.hunks.push(hunk);
        return;
      }

      recordHunkLine(state, line);
    },
    finalize() {
      return finalizeSection(state);
    },
  };
}

function pushFinalizedSection(
  sections: ParsedDiffSection[],
  builder: SectionBuilder | null,
): SectionBuilder | null {
  const section = builder?.finalize();
  if (section) {
    sections.push(section);
  }

  return null;
}

export function parseUnifiedDiff(raw: string): ParsedDiffSection[] {
  const sections: ParsedDiffSection[] = [];
  let builder: SectionBuilder | null = null;

  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      builder = pushFinalizedSection(sections, builder);
      builder = createSectionBuilder(line);
      continue;
    }

    builder?.appendLine(line);
  }

  pushFinalizedSection(sections, builder);
  return sections;
}

export function getCanonicalPath(section: ParsedDiffSection): string {
  const preferred = section.newPath !== "/dev/null" ? section.newPath : section.oldPath;
  return toNormalizedPath(preferred);
}

export function getOldPath(section: ParsedDiffSection): string | undefined {
  const canonical = getCanonicalPath(section);
  if (section.oldPath === "/dev/null" || section.oldPath === canonical) {
    return undefined;
  }

  return toNormalizedPath(section.oldPath);
}

export function sectionMatchesPaths(section: ParsedDiffSection, paths: readonly string[]): boolean {
  const normalizedPaths = new Set(paths.map((value) => toNormalizedPath(value)));
  return [
    getCanonicalPath(section),
    toNormalizedPath(section.oldPath),
    toNormalizedPath(section.newPath),
  ].some((value) => value.length > 0 && value !== "/dev/null" && normalizedPaths.has(value));
}
