import { collapseLineNumbers, mergeLineRanges } from "../../kernel/line-ranges.ts";
import type { LineRange } from "../config.ts";
import {
  CHANGED_LINE_WINDOW_PADDING,
  MAX_SNIPPET_COVERAGE_RATIO,
  MAX_SNIPPET_TOTAL_LINES,
  MAX_SNIPPET_WINDOW_LINES,
  MAX_SNIPPET_WINDOWS,
} from "./constants.ts";
import type {
  ChangeDeltaRanges,
  ChangedLineSnippetPlan,
  GuardrailMatcherSnippet,
  SnippetOnlyPlan,
} from "./types.ts";

export function buildChangedLineSnippetPlan(params: {
  source: "after" | "before";
  content: string;
  changedLines: LineRange[];
}): ChangedLineSnippetPlan {
  const { source, content, changedLines } = params;
  const contentLines = splitLines(content);
  const fullSourceSnippet = (): SnippetOnlyPlan => ({
    mode: "snippets",
    snippets: [
      {
        source,
        baseLine: 1,
        range: { startLine: 1, endLine: contentLines.length },
        content,
      },
    ],
  });
  if (contentLines.length === 0) {
    return { mode: "full_file", reason: "empty_after_content" };
  }

  const expandedWindows = mergeLineRanges(
    changedLines.map((range) =>
      expandLineRange(range, contentLines.length, CHANGED_LINE_WINDOW_PADDING),
    ),
    undefined,
  );
  if (!expandedWindows || expandedWindows.length === 0) {
    return { mode: "full_file", reason: "empty_after_content" };
  }

  if (expandedWindows.length > MAX_SNIPPET_WINDOWS) {
    if (source === "before") return fullSourceSnippet();
    return { mode: "full_file", reason: "too_many_windows" };
  }

  if (expandedWindows.some((range) => lineRangeSize(range) > MAX_SNIPPET_WINDOW_LINES)) {
    if (source === "before") return fullSourceSnippet();
    return { mode: "full_file", reason: "window_too_large" };
  }

  const totalWindowLines = sumLineRanges(expandedWindows);
  if (
    totalWindowLines > MAX_SNIPPET_TOTAL_LINES ||
    totalWindowLines / contentLines.length > MAX_SNIPPET_COVERAGE_RATIO
  ) {
    if (source === "before") return fullSourceSnippet();
    return { mode: "full_file", reason: "coverage_too_large" };
  }

  return {
    mode: "snippets",
    snippets: expandedWindows.map((range) => ({
      source,
      baseLine: range.startLine,
      range,
      content: contentLines.slice(range.startLine - 1, range.endLine).join("\n"),
    })),
  };
}

export function computeChangeDeltaRangesFromContents(
  beforeContent: string | null,
  afterContent: string | null,
): ChangeDeltaRanges {
  if (beforeContent === afterContent) {
    return {
      addedAfterLineRanges: [],
      deletedBeforeLineRanges: [],
    };
  }

  const beforeLines = splitLines(beforeContent ?? "");
  const afterLines = splitLines(afterContent ?? "");
  if (beforeLines.length === 0) {
    return {
      addedAfterLineRanges:
        afterLines.length > 0 ? [{ startLine: 1, endLine: afterLines.length }] : [],
      deletedBeforeLineRanges: [],
    };
  }

  if (afterLines.length === 0) {
    return {
      addedAfterLineRanges: [],
      deletedBeforeLineRanges: [{ startLine: 1, endLine: beforeLines.length }],
    };
  }

  return computeChangeDeltaRanges(beforeLines, afterLines);
}

export function rangesOverlap(range: LineRange, targets: LineRange[]): boolean {
  return targets.some(
    (target) => range.startLine <= target.endLine && target.startLine <= range.endLine,
  );
}

export function mapSnippetRegions(
  regions: LineRange[],
  snippet: GuardrailMatcherSnippet | undefined,
): LineRange[] {
  if (!snippet) {
    return regions;
  }

  const offset = snippet.baseLine - 1;
  return regions.map((region) => ({
    startLine: region.startLine + offset,
    endLine: region.endLine + offset,
  }));
}

function expandLineRange(range: LineRange, maxLine: number, padding: number): LineRange {
  return {
    startLine: Math.max(1, range.startLine - padding),
    endLine: Math.min(maxLine, range.endLine + padding),
  };
}

function sumLineRanges(ranges: LineRange[]): number {
  return ranges.reduce((total, range) => total + lineRangeSize(range), 0);
}

function lineRangeSize(range: LineRange): number {
  return range.endLine - range.startLine + 1;
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  return value.split(/\r?\n/);
}

function computeChangeDeltaRanges(beforeLines: string[], afterLines: string[]): ChangeDeltaRanges {
  const lcs = buildLcsMatrix(beforeLines, afterLines);
  const addedAfterLines: number[] = [];
  const deletedBeforeLines: number[] = [];

  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if ((lcs[beforeIndex + 1]?.[afterIndex] ?? 0) >= (lcs[beforeIndex]?.[afterIndex + 1] ?? 0)) {
      deletedBeforeLines.push(beforeIndex + 1);
      beforeIndex += 1;
      continue;
    }

    addedAfterLines.push(afterIndex + 1);
    afterIndex += 1;
  }

  while (afterIndex < afterLines.length) {
    addedAfterLines.push(afterIndex + 1);
    afterIndex += 1;
  }

  while (beforeIndex < beforeLines.length) {
    deletedBeforeLines.push(beforeIndex + 1);
    beforeIndex += 1;
  }

  return {
    addedAfterLineRanges: collapseLineNumbers(addedAfterLines),
    deletedBeforeLineRanges: collapseLineNumbers(deletedBeforeLines),
  };
}

function buildLcsMatrix(beforeLines: string[], afterLines: string[]): number[][] {
  const lcs = Array.from({ length: beforeLines.length + 1 }, () =>
    Array<number>(afterLines.length + 1).fill(0),
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lcs[beforeIndex]![afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? (lcs[beforeIndex + 1]?.[afterIndex + 1] ?? 0) + 1
          : Math.max(
              lcs[beforeIndex + 1]?.[afterIndex] ?? 0,
              lcs[beforeIndex]?.[afterIndex + 1] ?? 0,
            );
    }
  }

  return lcs;
}
