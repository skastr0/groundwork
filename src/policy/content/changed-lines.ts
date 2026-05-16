import path from "node:path";
import type { GuardrailChangeTarget, GuardrailContentMatcher, LineRange } from "../config.ts";
import { runMatcherBatchRegionsForPlan } from "./batches.ts";
import { readFileText } from "./files.ts";
import {
  buildChangedLineSnippetPlan,
  computeChangeDeltaRangesFromContents,
  rangesOverlap,
} from "./snippets.ts";
import type { ChangedLineSnippetPlan, ContentMatchRegionRunner } from "./types.ts";

type ContentMatchMode = "all" | "any";
type MatcherExpectationEvaluator = (
  matcher: GuardrailContentMatcher,
  matched: boolean,
) => boolean;

interface ChangedLineSelection {
  changedLines: LineRange[];
  deletedLines: LineRange[];
}

interface ChangedLineSnippetPlans {
  afterSnippetPlan: ChangedLineSnippetPlan | null;
  beforeSnippetPlan: ChangedLineSnippetPlan | null;
}

interface PresentMatcherEntry {
  matcher: GuardrailContentMatcher;
  index: number;
}

interface ChangedLineMatcherRegions {
  afterRegions: LineRange[][];
  beforeByIndex: Map<number, LineRange[]>;
}

export async function filterChangedLineTarget(params: {
  rootDir: string;
  target: GuardrailChangeTarget;
  matchers: GuardrailContentMatcher[];
  mode: ContentMatchMode;
  regionRunner: ContentMatchRegionRunner;
  nativeRegionRunner: ContentMatchRegionRunner;
  evaluateMatcherExpectation: MatcherExpectationEvaluator;
}): Promise<string | null> {
  const {
    rootDir,
    target,
    matchers,
    mode,
    regionRunner,
    nativeRegionRunner,
    evaluateMatcherExpectation,
  } = params;
  const normalizedPath = target.normalizedPath;
  const filePath = path.isAbsolute(normalizedPath)
    ? normalizedPath
    : path.resolve(rootDir, normalizedPath);
  const afterContent = await readFileText(filePath);
  const lineSelection = selectChangedLineRanges(target, afterContent);
  if (lineSelection.changedLines.length === 0 && lineSelection.deletedLines.length === 0) {
    return null;
  }

  const snippetPlans = buildChangedLineSnippetPlans(target, afterContent, lineSelection);
  const regions = await loadChangedLineMatcherRegions({
    rootDir,
    filePath,
    matchers,
    regionRunner,
    nativeRegionRunner,
    snippetPlans,
  });
  const checks = evaluateChangedLineChecks({
    matchers,
    lineSelection,
    regions,
    evaluateMatcherExpectation,
  });
  const isMatch = mode === "all" ? checks.every(Boolean) : checks.some(Boolean);
  return isMatch ? normalizedPath : null;
}

function selectChangedLineRanges(
  target: GuardrailChangeTarget,
  afterContent: string | null,
): ChangedLineSelection {
  const delta = computeChangeDeltaRangesFromContents(target.beforeContent ?? null, afterContent);
  return {
    changedLines:
      target.changedLineRanges && target.changedLineRanges.length > 0
        ? target.changedLineRanges
        : delta.addedAfterLineRanges,
    deletedLines:
      target.deletedLineRanges && target.deletedLineRanges.length > 0
        ? target.deletedLineRanges
        : delta.deletedBeforeLineRanges,
  };
}

function buildChangedLineSnippetPlans(
  target: GuardrailChangeTarget,
  afterContent: string | null,
  lineSelection: ChangedLineSelection,
): ChangedLineSnippetPlans {
  const { changedLines, deletedLines } = lineSelection;
  const afterSnippetPlan =
    afterContent !== null && changedLines.length > 0
      ? buildChangedLineSnippetPlan({
          source: "after",
          content: afterContent,
          changedLines,
        })
      : null;
  const beforeSnippetPlan =
    target.beforeContent !== null && target.beforeContent !== undefined && deletedLines.length > 0
      ? buildChangedLineSnippetPlan({
          source: "before",
          content: target.beforeContent,
          changedLines: deletedLines,
        })
      : null;
  return { afterSnippetPlan, beforeSnippetPlan };
}

async function loadChangedLineMatcherRegions(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  regionRunner: ContentMatchRegionRunner;
  nativeRegionRunner: ContentMatchRegionRunner;
  snippetPlans: ChangedLineSnippetPlans;
}): Promise<ChangedLineMatcherRegions> {
  const { rootDir, filePath, matchers, regionRunner, nativeRegionRunner, snippetPlans } = params;
  const afterRegions =
    snippetPlans.afterSnippetPlan === null
      ? matchers.map(() => [] as LineRange[])
      : await runMatcherBatchRegionsForPlan({
          rootDir,
          filePath,
          matchers,
          regionRunner,
          nativeRegionRunner,
          snippetPlan: snippetPlans.afterSnippetPlan,
        });
  const presentMatchers = getPresentMatchers(matchers);
  const beforeRegions =
    snippetPlans.beforeSnippetPlan === null || presentMatchers.length === 0
      ? []
      : await runMatcherBatchRegionsForPlan({
          rootDir,
          filePath,
          matchers: presentMatchers.map((entry) => entry.matcher),
          regionRunner,
          nativeRegionRunner,
          snippetPlan: snippetPlans.beforeSnippetPlan,
        });
  return {
    afterRegions,
    beforeByIndex: indexBeforeMatcherRegions(presentMatchers, beforeRegions),
  };
}

function getPresentMatchers(matchers: GuardrailContentMatcher[]): PresentMatcherEntry[] {
  return matchers.flatMap((matcher, index) =>
    (matcher.expect ?? "present") === "absent" ? [] : [{ matcher, index }],
  );
}

function indexBeforeMatcherRegions(
  presentMatchers: PresentMatcherEntry[],
  beforeRegions: LineRange[][],
): Map<number, LineRange[]> {
  const beforeByIndex = new Map<number, LineRange[]>();
  for (const [offset, entry] of presentMatchers.entries()) {
    beforeByIndex.set(entry.index, beforeRegions[offset] ?? []);
  }
  return beforeByIndex;
}

function evaluateChangedLineChecks(params: {
  matchers: GuardrailContentMatcher[];
  lineSelection: ChangedLineSelection;
  regions: ChangedLineMatcherRegions;
  evaluateMatcherExpectation: MatcherExpectationEvaluator;
}): boolean[] {
  const { matchers, lineSelection, regions, evaluateMatcherExpectation } = params;
  return matchers.map((matcher, index) => {
    const afterPresence = (regions.afterRegions[index] ?? []).some((region) =>
      rangesOverlap(region, lineSelection.changedLines),
    );
    const beforePresence =
      (matcher.expect ?? "present") === "absent"
        ? false
        : (regions.beforeByIndex.get(index) ?? []).some((region) =>
            rangesOverlap(region, lineSelection.deletedLines),
          );

    return evaluateMatcherExpectation(matcher, afterPresence || beforePresence);
  });
}
