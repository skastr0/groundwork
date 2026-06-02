import path from "node:path";
import type {
  AstGrepContentMatcher,
  ContentMatchRunner,
  GuardrailChangeTarget,
  GuardrailContentMatcher,
  GuardrailContentScope,
  GuardrailRule,
  SemgrepContentMatcher,
} from "../config.ts";
import { runAstGrepMatcherRegions } from "./ast-grep.ts";
import { runNativeMatcherBatchRegionsForSource } from "./batches.ts";
import { filterChangedLineTarget } from "./changed-lines.ts";
import { runBoundedEffect } from "./concurrency.ts";
import { isRegularFile } from "./files.ts";
import { runSemgrepMatcherRegions } from "./semgrep.ts";
import type { ContentMatchRegionRunner } from "./types.ts";

export function resolveRuleScope(rule: GuardrailRule): GuardrailContentScope {
  if (rule.scope) return rule.scope;
  if (rule.content && rule.content.length > 0) return "changed_lines";
  return "full_file";
}

export function ruleContentMatcherType(rule: GuardrailRule): "none" | "ast_grep" | "semgrep" {
  if (!rule.content || rule.content.length === 0) return "none";
  return rule.content[0]?.type ?? "none";
}

export async function filterPathsByRuleContent(params: {
  rootDir: string;
  normalizedPaths?: string[];
  targets?: GuardrailChangeTarget[];
  rule: GuardrailRule;
  runner?: ContentMatchRunner;
  regionRunner?: ContentMatchRegionRunner;
  beforeContents?: Map<string, string | null>;
}): Promise<string[]> {
  const {
    rootDir,
    rule,
    runner = runContentMatcher,
    regionRunner = runContentMatcherRegions,
    beforeContents,
  } = params;
  const targets = materializeChangeTargets(
    params.targets,
    params.normalizedPaths ?? [],
    beforeContents,
  );
  if (targets.length === 0) {
    return [];
  }
  if (!rule.content || rule.content.length === 0) {
    return targets.map((target) => target.normalizedPath);
  }

  if (resolveRuleScope(rule) === "changed_lines") {
    return filterPathsByChangedLines({
      rootDir,
      targets,
      rule,
      regionRunner,
    });
  }

  const matchers = rule.content;
  const mode = rule.content_mode ?? "any";
  const matched = await runBoundedEffect(targets, async (target) => {
    const normalizedPath = target.normalizedPath;
    const filePath = path.isAbsolute(normalizedPath)
      ? normalizedPath
      : path.resolve(rootDir, normalizedPath);
    const isFile = await isRegularFile(filePath);
    if (!isFile) return null;

    const checks =
      runner === runContentMatcher
        ? (
            await runNativeMatcherBatchRegionsForSource({
              rootDir,
              filePath,
              matchers,
            })
          ).map((regions, index) =>
            evaluateMatcherExpectation(matchers[index]!, regions.length > 0),
          )
        : await runBoundedEffect(matchers, async (matcher) => {
            const matched = await runner({ rootDir, filePath, matcher });
            return evaluateMatcherExpectation(matcher, matched);
          });

    const isMatch = mode === "all" ? checks.every(Boolean) : checks.some(Boolean);
    return isMatch ? normalizedPath : null;
  });

  return matched.filter((value): value is string => value !== null);
}

export async function runContentMatcher(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
}): Promise<boolean> {
  const regions = await runContentMatcherRegions(params);
  return regions.length > 0;
}

async function runContentMatcherRegions(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
  snippet?: Parameters<ContentMatchRegionRunner>[0]["snippet"];
}) {
  if (params.matcher.type === "semgrep") {
    return runSemgrepMatcherRegions({
      rootDir: params.rootDir,
      filePath: params.filePath,
      matcher: params.matcher,
      snippet: params.snippet,
    });
  }

  return runAstGrepMatcherRegions({
    filePath: params.filePath,
    matcher: params.matcher,
    snippet: params.snippet,
  });
}

export async function runAstGrepMatcher(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
}): Promise<boolean> {
  const matcher = params.matcher as AstGrepContentMatcher;
  if (matcher.type !== "ast_grep") {
    throw new Error(`Unsupported ast-grep matcher type '${String(params.matcher.type)}'`);
  }

  const regions = await runAstGrepMatcherRegions({
    filePath: params.filePath,
    matcher,
  });
  return regions.length > 0;
}

export async function runSemgrepMatcher(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
}): Promise<boolean> {
  const matcher = params.matcher as SemgrepContentMatcher;
  if (matcher.type !== "semgrep") {
    throw new Error(`Unsupported semgrep matcher type '${String(params.matcher.type)}'`);
  }

  const regions = await runSemgrepMatcherRegions({
    rootDir: params.rootDir,
    filePath: params.filePath,
    matcher,
  });
  return regions.length > 0;
}

function evaluateMatcherExpectation(matcher: GuardrailContentMatcher, matched: boolean): boolean {
  const expect = matcher.expect ?? "present";
  return expect === "absent" ? !matched : matched;
}

async function filterPathsByChangedLines(params: {
  rootDir: string;
  targets: GuardrailChangeTarget[];
  rule: GuardrailRule;
  regionRunner: ContentMatchRegionRunner;
}): Promise<string[]> {
  const { rootDir, targets, rule, regionRunner } = params;
  if (!rule.content || rule.content.length === 0) {
    return targets.map((target) => target.normalizedPath);
  }

  const matchers = rule.content;
  const mode = rule.content_mode ?? "any";
  const matched = await runBoundedEffect(targets, (target) =>
    filterChangedLineTarget({
      rootDir,
      target,
      matchers,
      mode,
      regionRunner,
      nativeRegionRunner: runContentMatcherRegions,
      evaluateMatcherExpectation,
    }),
  );

  return matched.filter((value): value is string => value !== null);
}

function materializeChangeTargets(
  targets: GuardrailChangeTarget[] | undefined,
  normalizedPaths: string[],
  beforeContents?: Map<string, string | null>,
): GuardrailChangeTarget[] {
  if (targets) {
    return targets;
  }

  return normalizedPaths.map((normalizedPath) => ({
    normalizedPath,
    beforeContent: beforeContents?.get(normalizedPath),
  }));
}
