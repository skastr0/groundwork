import type {
  AstGrepContentMatcher,
  GuardrailContentMatcher,
  LineRange,
  SemgrepContentMatcher,
} from "../config.ts";
import { runAstGrepMatcherBatchRegions } from "./ast-grep.ts";
import { runBoundedEffect } from "./concurrency.ts";
import { runSemgrepMatcherBatchRegions } from "./semgrep.ts";
import { mapSnippetRegions } from "./snippets.ts";
import type {
  ChangedLineSnippetPlan,
  ContentMatchRegionRunner,
  GuardrailMatcherSnippet,
  SnippetOnlyPlan,
} from "./types.ts";

export async function runNativeMatcherBatchRegionsForSource(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, snippet } = params;
  const results = matchers.map(() => [] as LineRange[]);

  const astEntries: Array<{ index: number; matcher: AstGrepContentMatcher }> = [];
  const semgrepGroups = new Map<string, Array<{ index: number; matcher: SemgrepContentMatcher }>>();

  for (const [index, matcher] of matchers.entries()) {
    if (matcher.type === "ast_grep") {
      astEntries.push({ index, matcher });
      continue;
    }

    const timeoutKey = String(matcher.timeout_s ?? "default");
    const group = semgrepGroups.get(timeoutKey) ?? [];
    group.push({ index, matcher });
    semgrepGroups.set(timeoutKey, group);
  }

  const tasks: Array<() => Promise<void>> = [];
  if (astEntries.length > 0) {
    tasks.push(async () => {
      const batch = await runAstGrepMatcherBatchRegions({
        filePath,
        entries: astEntries,
        snippet,
      });
      for (const entry of astEntries) {
        results[entry.index] = batch[entry.index] ?? [];
      }
    });
  }

  for (const entries of semgrepGroups.values()) {
    tasks.push(async () => {
      const batch = await runSemgrepMatcherBatchRegions({
        rootDir,
        filePath,
        entries,
        snippet,
      });
      for (const entry of entries) {
        results[entry.index] = batch[entry.index] ?? [];
      }
    });
  }

  await runBoundedEffect(tasks, (task) => task());
  return results;
}

export async function runMatcherBatchRegionsForPlan(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  regionRunner: ContentMatchRegionRunner;
  nativeRegionRunner: ContentMatchRegionRunner;
  snippetPlan: ChangedLineSnippetPlan;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, regionRunner, nativeRegionRunner, snippetPlan } = params;
  if (snippetPlan.mode === "full_file") {
    return runMatcherBatchRegionsForSource({
      rootDir,
      filePath,
      matchers,
      regionRunner,
      nativeRegionRunner,
    });
  }

  try {
    return regionRunner === nativeRegionRunner
      ? await runNativeMatcherBatchRegionsForSnippetPlan({
          rootDir,
          filePath,
          matchers,
          snippetPlan,
        })
      : await runCustomMatcherBatchRegionsForSnippetPlan({
          rootDir,
          filePath,
          matchers,
          regionRunner,
          snippetPlan,
        });
  } catch {
    return runMatcherBatchRegionsForSource({
      rootDir,
      filePath,
      matchers,
      regionRunner,
      nativeRegionRunner,
    });
  }
}

export async function runMatcherBatchRegionsForSource(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  regionRunner: ContentMatchRegionRunner;
  nativeRegionRunner: ContentMatchRegionRunner;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, regionRunner, nativeRegionRunner, snippet } = params;
  if (regionRunner === nativeRegionRunner) {
    return runNativeMatcherBatchRegionsForSource({
      rootDir,
      filePath,
      matchers,
      snippet,
    });
  }

  return runCustomMatcherBatchRegionsForSource({
    rootDir,
    filePath,
    matchers,
    regionRunner,
    snippet,
  });
}

async function runNativeMatcherBatchRegionsForSnippetPlan(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  snippetPlan: SnippetOnlyPlan;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, snippetPlan } = params;
  const aggregated = matchers.map(() => [] as LineRange[]);

  const perSnippet = await runBoundedEffect(snippetPlan.snippets, (snippet) =>
    runNativeMatcherBatchRegionsForSource({
      rootDir,
      filePath,
      matchers,
      snippet,
    }),
  );

  for (const snippetResult of perSnippet) {
    for (const [index, regions] of snippetResult.entries()) {
      aggregated[index]!.push(...regions);
    }
  }

  return aggregated;
}

async function runCustomMatcherBatchRegionsForSnippetPlan(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  regionRunner: ContentMatchRegionRunner;
  snippetPlan: SnippetOnlyPlan;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, regionRunner, snippetPlan } = params;
  const aggregated = matchers.map(() => [] as LineRange[]);

  const perSnippet = await runBoundedEffect(snippetPlan.snippets, (snippet) =>
    runCustomMatcherBatchRegionsForSource({
      rootDir,
      filePath,
      matchers,
      regionRunner,
      snippet,
    }),
  );

  for (const snippetResult of perSnippet) {
    for (const [index, regions] of snippetResult.entries()) {
      aggregated[index]!.push(...regions);
    }
  }

  return aggregated;
}

async function runCustomMatcherBatchRegionsForSource(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  regionRunner: ContentMatchRegionRunner;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, regionRunner, snippet } = params;
  return runBoundedEffect(matchers, async (matcher) => {
    const regions = await regionRunner({ rootDir, filePath, matcher, snippet });
    return mapSnippetRegions(regions, snippet);
  });
}
