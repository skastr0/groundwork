import path from "node:path";
import type { AstGrepContentMatcher, LineRange } from "../config.ts";
import { spawnProcess } from "./files.ts";
import { mapSnippetRegions } from "./snippets.ts";
import type { GuardrailMatcherSnippet } from "./types.ts";

const EXTENSION_TO_AST_GREP_LANGUAGE = new Map<string, string>([
  [".ts", "ts"],
  [".tsx", "tsx"],
  [".js", "js"],
  [".jsx", "jsx"],
  [".mjs", "js"],
  [".cjs", "js"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".toml", "toml"],
  [".rs", "rust"],
  [".py", "python"],
  [".go", "go"],
  [".java", "java"],
  [".swift", "swift"],
  [".kt", "kotlin"],
  [".cpp", "cpp"],
  [".cc", "cpp"],
  [".cxx", "cpp"],
  [".c", "c"],
  [".h", "c"],
  [".cs", "csharp"],
  [".rb", "ruby"],
  [".php", "php"],
  [".scala", "scala"],
  [".lua", "lua"],
  [".sql", "sql"],
  [".css", "css"],
  [".scss", "scss"],
  [".html", "html"],
  [".md", "markdown"],
  [".sh", "bash"],
  [".bash", "bash"],
]);

export async function runAstGrepMatcherRegions(params: {
  filePath: string;
  matcher: AstGrepContentMatcher;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[]> {
  const { filePath, matcher, snippet } = params;
  const batch = await runAstGrepMatcherBatchRegions({
    filePath,
    entries: [{ index: 0, matcher }],
    snippet,
  });
  return batch[0] ?? [];
}

export async function runAstGrepMatcherBatchRegions(params: {
  filePath: string;
  entries: Array<{ index: number; matcher: AstGrepContentMatcher }>;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[][]> {
  const { filePath, entries, snippet } = params;
  const results: LineRange[][] = [];
  const inlineRules = entries
    .map((entry) =>
      buildAstGrepInlineRule(astGrepBatchRuleId(entry.index), entry.matcher, filePath),
    )
    .join("\n---\n");

  const cmd = ["sg", "scan", "--inline-rules", inlineRules, "--json=stream"];
  const output = snippet
    ? await spawnProcess({ cmd: [...cmd, "--stdin"], stdinText: snippet.content })
    : await spawnProcess({ cmd: [...cmd, filePath] });

  if (output.exitCode !== 0 && output.exitCode !== 1) {
    const reason = output.stderr.trim() || `exit code ${output.exitCode}`;
    throw new Error(`ast-grep failed for '${filePath}': ${reason}`);
  }

  const matches = parseAstGrepBatchMatches(output.stdout);
  const byRuleId = new Map<string, LineRange[]>();
  for (const match of matches) {
    const existing = byRuleId.get(match.ruleId) ?? [];
    existing.push(mapSnippetRegions([match.range], snippet)[0]!);
    byRuleId.set(match.ruleId, existing);
  }

  for (const entry of entries) {
    results[entry.index] = byRuleId.get(astGrepBatchRuleId(entry.index)) ?? [];
  }

  return results;
}

function astGrepBatchRuleId(index: number): string {
  return `groundwork-policy-ast-${index}`;
}

function buildAstGrepInlineRule(
  id: string,
  matcher: AstGrepContentMatcher,
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

function indentYamlBlock(value: string, spaces: number): string {
  const indent = " ".repeat(spaces);
  return value
    .split(/\r?\n/)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function parseAstGrepBatchMatches(output: string): Array<{
  ruleId: string;
  range: LineRange;
}> {
  if (output.trim().length === 0) return [];

  const matches: Array<{ ruleId: string; range: LineRange }> = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const parsed = JSON.parse(trimmed) as {
      ruleId?: string;
      range?: {
        start?: { line?: number };
        end?: { line?: number };
      };
    };
    const start = parsed.range?.start?.line;
    const end = parsed.range?.end?.line;
    if (typeof parsed.ruleId !== "string") continue;
    if (typeof start !== "number" || typeof end !== "number") continue;
    matches.push({
      ruleId: parsed.ruleId,
      range: { startLine: start + 1, endLine: end + 1 },
    });
  }

  return matches;
}

function inferAstGrepLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_AST_GREP_LANGUAGE.get(ext);
}
