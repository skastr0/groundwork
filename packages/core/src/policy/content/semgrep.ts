import type { LineRange, SemgrepContentMatcher, SemgrepSeverity } from "../config.ts";
import {
  resolveConfigPath,
  runMatcherCliAgainstSource,
  spawnProcess,
} from "./files.ts";
import { mapSnippetRegions } from "./snippets.ts";
import type { GuardrailMatcherSnippet } from "./types.ts";

export async function runSemgrepMatcherRegions(params: {
  rootDir: string;
  filePath: string;
  matcher: SemgrepContentMatcher;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[]> {
  const { rootDir, filePath, matcher, snippet } = params;
  const batch = await runSemgrepMatcherBatchRegions({
    rootDir,
    filePath,
    entries: [{ index: 0, matcher }],
    snippet,
  });
  return batch[0] ?? [];
}

export async function runSemgrepMatcherBatchRegions(params: {
  rootDir: string;
  filePath: string;
  entries: Array<{ index: number; matcher: SemgrepContentMatcher }>;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, entries, snippet } = params;
  const results: LineRange[][] = [];
  const configPaths = Array.from(
    new Set(
      entries.flatMap((entry) =>
        entry.matcher.configs.map((config) => resolveConfigPath(rootDir, config)),
      ),
    ),
  );
  const cmd = ["semgrep", "scan", "--error", "--quiet", "--json"];

  for (const configPath of configPaths) {
    cmd.push("--config", configPath);
  }

  const timeoutValues = entries
    .map((entry) => entry.matcher.timeout_s)
    .filter((value): value is number => typeof value === "number");
  if (timeoutValues.length > 0) {
    cmd.push("--timeout", String(Math.max(...timeoutValues)));
  }

  const output = await runMatcherCliAgainstSource({
    filePath,
    snippet,
    run: async (sourcePath) => spawnProcess({ cmd: [...cmd, sourcePath] }),
  });

  if (output.exitCode !== 0 && output.exitCode !== 1) {
    const reason = output.stderr.trim() || output.stdout.trim() || `exit code ${output.exitCode}`;
    throw new Error(`semgrep failed for '${filePath}': ${reason}`);
  }

  const findings = parseSemgrepFindings(output.stdout);
  for (const entry of entries) {
    results[entry.index] = findings
      .filter((finding) => semgrepFindingMatchesMatcher(finding, entry.matcher))
      .map((finding) => mapSnippetRegions([finding.range], snippet)[0]!);
  }

  return results;
}

function parseSemgrepFindings(output: string): Array<{
  checkID: string | undefined;
  severity: SemgrepSeverity | undefined;
  range: LineRange;
}> {
  if (output.trim().length === 0) return [];

  const parsed = JSON.parse(output) as {
    results?: Array<{
      check_id?: string;
      start?: { line?: number };
      end?: { line?: number };
      extra?: { severity?: SemgrepSeverity };
    }>;
  };

  return (parsed.results ?? [])
    .map((result) => {
      const start = result.start?.line;
      const end = result.end?.line;
      if (typeof start !== "number" || typeof end !== "number") {
        return null;
      }

      return {
        checkID: result.check_id,
        severity: result.extra?.severity,
        range: { startLine: start, endLine: end },
      };
    })
    .filter(
      (
        finding,
      ): finding is {
        checkID: string | undefined;
        severity: SemgrepSeverity | undefined;
        range: LineRange;
      } => finding !== null,
    );
}

function semgrepFindingMatchesMatcher(
  finding: { checkID: string | undefined; severity: SemgrepSeverity | undefined; range: LineRange },
  matcher?: SemgrepContentMatcher,
): boolean {
  if (!matcher) return true;
  if (matcher.severity && matcher.severity.length > 0) {
    if (!finding.severity || !matcher.severity.includes(finding.severity)) {
      return false;
    }
  }

  return semgrepResultMatchesMatcher(finding.checkID, matcher);
}

function semgrepResultMatchesMatcher(
  checkID: string | undefined,
  matcher?: SemgrepContentMatcher,
): boolean {
  if (!matcher) return true;

  const include = matcher.include_rule_ids ?? [];
  if (include.length > 0) {
    if (!checkID) return false;
    if (!include.some((ruleID) => semgrepRuleIdMatches(checkID, ruleID))) {
      return false;
    }
  }

  const exclude = matcher.exclude_rule_ids ?? [];
  if (exclude.length > 0) {
    if (!checkID) return true;
    if (exclude.some((ruleID) => semgrepRuleIdMatches(checkID, ruleID))) {
      return false;
    }
  }

  return true;
}

function semgrepRuleIdMatches(checkID: string, expectedRuleID: string): boolean {
  return (
    checkID === expectedRuleID ||
    checkID.endsWith(`.${expectedRuleID}`) ||
    checkID.endsWith(`/` + expectedRuleID)
  );
}
