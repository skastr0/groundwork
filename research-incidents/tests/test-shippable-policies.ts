#!/usr/bin/env bun
/**
 * Standalone fixture runner for `research-incidents/shippable-now/*.toml`
 * policy rules that use ast_grep or semgrep content matching.
 *
 * Reads each shippable TOML rule, parses it, discovers positive/negative fixtures
 * under `../fixtures/<rule-id>/`, runs the matcher CLI against them, and reports
 * pass/fail per rule. Rules that cannot be exercised without the full Groundwork
 * runtime are marked `pending-runtime`.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MatcherExpectation = "present" | "absent";

type AstGrepMatcher = {
  type: "ast_grep";
  pattern: string;
  selector?: string;
  language?: string;
  strictness?: string;
  expect?: MatcherExpectation;
};

type SemgrepMatcher = {
  type: "semgrep";
  configs: string[];
  severity?: string[];
  include_rule_ids?: string[];
  exclude_rule_ids?: string[];
  timeout_s?: number;
  expect?: MatcherExpectation;
};

type ContentMatcher = AstGrepMatcher | SemgrepMatcher;

type GuardrailAction =
  | { type: "inject_prompt"; text: string }
  | { type: "block_tool"; message?: string }
  | { type: "require_human_override"; message?: string }
  | { type: "stop_session"; message?: string }
  | { type: "ensure_skill_loaded"; skills: string[] };

type GuardrailRule = {
  id: string;
  description?: string;
  severity?: string;
  match?: string[];
  tools_include?: string[];
  tools_exclude?: string[];
  content?: ContentMatcher[];
  content_mode?: "any" | "all";
  scope?: "changed_lines" | "full_file";
  actions: GuardrailAction[];
};

type PolicyFile = {
  version: number;
  rules: GuardrailRule[];
};

type FixtureResult = {
  kind: "positive" | "negative";
  file: string;
  matched: boolean;
  error?: string;
};

type MatcherResult = {
  matcherIndex: number;
  matcherType: "ast_grep" | "semgrep";
  results: FixtureResult[];
};

type RuleResult = {
  ruleId: string;
  sourceToml: string;
  status: "pass" | "fail" | "pending-runtime" | "no-fixtures";
  reason?: string;
  matcherResults: MatcherResult[];
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const rootDir = path.resolve(import.meta.dir, "..", "..");
const incidentsDir = path.resolve(rootDir, "research-incidents");
const shippableDir = path.resolve(incidentsDir, "shippable-now");
const fixturesDir = path.resolve(incidentsDir, "fixtures");

async function discoverShippablePolicies(): Promise<string[]> {
  if (!existsSync(shippableDir)) return [];
  const entries = await readdir(shippableDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".toml"))
    .map((e) => path.resolve(shippableDir, e.name))
    .sort();
}

async function loadPolicy(filePath: string): Promise<PolicyFile> {
  const text = await readFile(filePath, "utf8");
  const parsed = Bun.TOML.parse(text) as unknown as PolicyFile;
  if (!parsed.rules || !Array.isArray(parsed.rules)) {
    throw new Error(`Missing or invalid 'rules' array in ${filePath}`);
  }
  return parsed;
}

async function discoverFixtures(ruleId: string): Promise<{
  positive: string[];
  negative: string[];
}> {
  const ruleFixtureDir = path.resolve(fixturesDir, ruleId);
  if (!existsSync(ruleFixtureDir)) {
    return { positive: [], negative: [] };
  }
  const entries = await readdir(ruleFixtureDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.resolve(ruleFixtureDir, e.name))
    .sort();
  return {
    positive: files.filter((f) => path.basename(f).startsWith("positive.")),
    negative: files.filter((f) => path.basename(f).startsWith("negative.")),
  };
}

// ---------------------------------------------------------------------------
// Matcher execution
// ---------------------------------------------------------------------------

function expectToBool(expect: MatcherExpectation | undefined, matched: boolean): boolean {
  return expect === "absent" ? !matched : matched;
}

function runCli(cmd: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

function inferAstGrepLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".mjs": "js",
    ".cjs": "js",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".rs": "rust",
    ".py": "python",
    ".go": "go",
    ".java": "java",
    ".swift": "swift",
    ".kt": "kotlin",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".c": "c",
    ".h": "c",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".scala": "scala",
    ".lua": "lua",
    ".sql": "sql",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".md": "markdown",
    ".sh": "bash",
    ".bash": "bash",
  };
  return map[ext];
}

function indentYamlBlock(value: string, spaces: number): string {
  const indent = " ".repeat(spaces);
  return value
    .split(/\r?\n/)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function buildAstGrepInlineRule(
  id: string,
  matcher: AstGrepMatcher,
  filePath: string,
): string {
  const language = matcher.language ?? inferAstGrepLanguage(filePath);
  if (!language) {
    throw new Error(`Unable to infer ast-grep language for '${filePath}'`);
  }
  if (matcher.selector || matcher.strictness) {
    const strictness = matcher.strictness ? `\n    strictness: ${matcher.strictness}` : "";
    const selector = matcher.selector ? `\n    selector: ${matcher.selector}` : "";
    return [
      `id: ${id}`,
      `language: ${language}`,
      "message: policy guardrail",
      "severity: warning",
      "rule:",
      "  pattern:",
      "    context: |",
      indentYamlBlock(matcher.pattern, 6),
      `${selector}${strictness}`,
    ].join("\n");
  }
  return [
    `id: ${id}`,
    `language: ${language}`,
    "message: policy guardrail",
    "severity: warning",
    "rule:",
    "  pattern: |",
    indentYamlBlock(matcher.pattern, 4),
  ].join("\n");
}

async function runAstGrepMatcher(
  matcher: AstGrepMatcher,
  filePath: string,
  ruleId: string,
  matcherIndex: number,
): Promise<{ matched: boolean; error?: string }> {
  const inlineRuleId = `${ruleId}-ast-${matcherIndex}`;
  let inlineRules: string;
  try {
    inlineRules = buildAstGrepInlineRule(inlineRuleId, matcher, filePath);
  } catch (err) {
    return { matched: false, error: String(err) };
  }
  try {
    const { exitCode, stdout, stderr } = await runCli([
      "sg",
      "scan",
      "--inline-rules",
      inlineRules,
      "--json=stream",
      filePath,
    ]);
    if (exitCode !== 0 && exitCode !== 1) {
      return { matched: false, error: stderr.trim() || `ast-grep exited ${exitCode}` };
    }
    const matched = stdout
      .split(/\r?\n/)
      .some((line) => line.trim() && line.includes(`"ruleId":"${inlineRuleId}"`));
    return { matched };
  } catch (err) {
    return { matched: false, error: String(err) };
  }
}

function semgrepFindingMatchesMatcher(
  finding: { checkID?: string; severity?: string },
  matcher: SemgrepMatcher,
): boolean {
  if (matcher.severity && matcher.severity.length > 0) {
    if (!finding.severity || !matcher.severity.includes(finding.severity)) {
      return false;
    }
  }
  const checkID = finding.checkID;
  const include = matcher.include_rule_ids ?? [];
  if (include.length > 0) {
    if (!checkID) return false;
    if (!include.some((id) => semgrepRuleIdMatches(checkID, id))) return false;
  }
  const exclude = matcher.exclude_rule_ids ?? [];
  if (exclude.length > 0) {
    if (!checkID) return true;
    if (exclude.some((id) => semgrepRuleIdMatches(checkID, id))) return false;
  }
  return true;
}

function semgrepRuleIdMatches(checkID: string, expected: string): boolean {
  return checkID === expected || checkID.endsWith(`.${expected}`) || checkID.endsWith(`/${expected}`);
}

async function runSemgrepMatcher(
  matcher: SemgrepMatcher,
  filePath: string,
  rootDir: string,
): Promise<{ matched: boolean; error?: string }> {
  const configPaths = matcher.configs.map((cfg) => {
    if (cfg.startsWith("~/")) {
      const home = process.env.HOME;
      return home ? path.join(home, cfg.slice(2)) : cfg;
    }
    return path.isAbsolute(cfg) ? cfg : path.resolve(rootDir, cfg);
  });
  const missing = configPaths.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return {
      matched: false,
      error: `semgrep config(s) not resolvable: ${missing.join(", ")}`,
    };
  }
  const cmd = ["semgrep", "scan", "--error", "--quiet", "--json"];
  for (const configPath of configPaths) {
    cmd.push("--config", configPath);
  }
  if (matcher.timeout_s !== undefined) {
    cmd.push("--timeout", String(matcher.timeout_s));
  }
  cmd.push(filePath);
  try {
    const { exitCode, stdout, stderr } = await runCli(cmd);
    if (exitCode !== 0 && exitCode !== 1) {
      return { matched: false, error: stderr.trim() || `semgrep exited ${exitCode}` };
    }
    const parsed = JSON.parse(stdout || "{}") as {
      results?: Array<{ check_id?: string; extra?: { severity?: string } }>;
    };
    const findings = (parsed.results ?? []).map((r) => ({
      checkID: r.check_id,
      severity: r.extra?.severity,
    }));
    const matched = findings.some((f) => semgrepFindingMatchesMatcher(f, matcher));
    return { matched };
  } catch (err) {
    return { matched: false, error: String(err) };
  }
}

async function runMatcher(
  matcher: ContentMatcher,
  filePath: string,
  ruleId: string,
  matcherIndex: number,
): Promise<{ matched: boolean; error?: string }> {
  if (matcher.type === "ast_grep") {
    return runAstGrepMatcher(matcher, filePath, ruleId, matcherIndex);
  }
  return runSemgrepMatcher(matcher, filePath, rootDir);
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

function ruleRequiresRuntime(rule: GuardrailRule): string | undefined {
  if (rule.scope === "changed_lines") {
    return "scope is 'changed_lines' (requires diff context)";
  }
  if (!rule.content || rule.content.length === 0) {
    return "no content matchers (requires command/message runtime)";
  }
  const hasOnlyAstOrSemgrep = rule.content.every(
    (m) => m.type === "ast_grep" || m.type === "semgrep",
  );
  if (!hasOnlyAstOrSemgrep) {
    return "contains non-ast_grep/semgrep matchers";
  }
  return undefined;
}

async function evaluateRule(
  rule: GuardrailRule,
  sourceToml: string,
): Promise<RuleResult> {
  const runtimeReason = ruleRequiresRuntime(rule);
  if (runtimeReason) {
    return {
      ruleId: rule.id,
      sourceToml,
      status: "pending-runtime",
      reason: runtimeReason,
      matcherResults: [],
    };
  }

  const fixtures = await discoverFixtures(rule.id);
  if (fixtures.positive.length === 0 && fixtures.negative.length === 0) {
    return {
      ruleId: rule.id,
      sourceToml,
      status: "no-fixtures",
      reason: `no fixtures in ${path.relative(incidentsDir, fixturesDir)}/${rule.id}`,
      matcherResults: [],
    };
  }

  const matchers = rule.content!;
  const matcherResults: MatcherResult[] = [];

  for (const [index, matcher] of matchers.entries()) {
    const results: FixtureResult[] = [];
    for (const file of fixtures.positive) {
      const { matched, error } = await runMatcher(matcher, file, rule.id, index);
      results.push({ kind: "positive", file, matched, error });
    }
    for (const file of fixtures.negative) {
      const { matched, error } = await runMatcher(matcher, file, rule.id, index);
      results.push({ kind: "negative", file, matched, error });
    }
    matcherResults.push({
      matcherIndex: index,
      matcherType: matcher.type,
      results,
    });
  }

  // Determine pass/fail.
  // For each fixture, decide whether the rule triggers given content_mode.
  const contentMode = rule.content_mode ?? "any";
  const positiveFiles = fixtures.positive;
  const negativeFiles = fixtures.negative;

  const positiveTriggers = positiveFiles.map((file) => {
    const perMatcher = matcherResults.map((mr) => {
      const r = mr.results.find((x) => x.file === file)!;
      const expected = expectToBool(matchers[mr.matcherIndex]!.expect, true);
      return r.matched === expected;
    });
    return contentMode === "all" ? perMatcher.every(Boolean) : perMatcher.some(Boolean);
  });

  const negativeTriggers = negativeFiles.map((file) => {
    const perMatcher = matcherResults.map((mr) => {
      const r = mr.results.find((x) => x.file === file)!;
      const expected = expectToBool(matchers[mr.matcherIndex]!.expect, true);
      return r.matched === expected;
    });
    return contentMode === "all" ? perMatcher.every(Boolean) : perMatcher.some(Boolean);
  });

  const positiveOk = positiveTriggers.every(Boolean);
  const negativeOk = negativeTriggers.every((t) => !t);
  const anyError = matcherResults.some((mr) => mr.results.some((r) => r.error));

  return {
    ruleId: rule.id,
    sourceToml,
    status: positiveOk && negativeOk && !anyError ? "pass" : "fail",
    matcherResults,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function formatFixtureResult(r: FixtureResult): string {
  const icon = r.error ? "⚠" : r.matched ? "✓" : "·";
  const expect = r.kind === "positive" ? "should match" : "should NOT match";
  let line = `    ${icon} ${r.kind}: ${path.basename(r.file)} -> matched=${r.matched} (${expect})`;
  if (r.error) line += `\n      error: ${r.error}`;
  return line;
}

function printReport(results: RuleResult[]): void {
  console.log("=".repeat(72));
  console.log("Groundwork research-incidents shippable policy fixture runner");
  console.log("=".repeat(72));

  const counts = { pass: 0, fail: 0, "pending-runtime": 0, "no-fixtures": 0 };
  for (const r of results) {
    counts[r.status]++;
    console.log("");
    console.log(`RULE: ${r.ruleId}`);
    console.log(`  source: ${path.relative(incidentsDir, r.sourceToml)}`);
    console.log(`  status: ${r.status.toUpperCase()}`);
    if (r.reason) console.log(`  reason: ${r.reason}`);
    for (const mr of r.matcherResults) {
      console.log(`  matcher ${mr.matcherIndex} (${mr.matcherType}):`);
      for (const fr of mr.results) {
        console.log(formatFixtureResult(fr));
      }
    }
  }

  console.log("");
  console.log("-".repeat(72));
  console.log(
    `SUMMARY: ${counts.pass} passed, ${counts.fail} failed, ${counts["pending-runtime"]} pending-runtime, ${counts["no-fixtures"]} no-fixtures`,
  );
  console.log("-".repeat(72));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const policyFiles = await discoverShippablePolicies();
  if (policyFiles.length === 0) {
    console.error(`No .toml policy files found in ${shippableDir}`);
    return 0;
  }

  const results: RuleResult[] = [];
  for (const filePath of policyFiles) {
    let policy: PolicyFile;
    try {
      policy = await loadPolicy(filePath);
    } catch (err) {
      results.push({
        ruleId: `<parse-error: ${path.basename(filePath)}>`,
        sourceToml: filePath,
        status: "fail",
        reason: String(err),
        matcherResults: [],
      });
      continue;
    }
    for (const rule of policy.rules) {
      results.push(await evaluateRule(rule, filePath));
    }
  }

  printReport(results);
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
