import { spawn } from "node:child_process";
import { existsSync, promises as fs, readdirSync, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "@iarna/toml";

export type GuardrailSeverity = "advisory" | "warn" | "block" | "terminate";
export type GuardrailMatcherExpectation = "present" | "absent";
export type GuardrailSkillEnforcementMode = "prompt" | "block";
export type GuardrailContentScope = "changed_lines" | "full_file";

export type GuardrailAction =
  | {
      type: "inject_prompt";
      text: string;
      once_per_session?: boolean;
    }
  | {
      type: "block_tool";
      message?: string;
    }
  | {
      type: "require_human_override";
      message?: string;
    }
  | {
      type: "stop_session";
      message?: string;
    }
  | {
      type: "ensure_skill_loaded";
      skills: string[];
      mode?: GuardrailSkillEnforcementMode;
      message?: string;
      once_per_session?: boolean;
    };

export type AstGrepStrictness = "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";

export type SemgrepSeverity = "INFO" | "WARNING" | "ERROR";

export type AstGrepContentMatcher = {
  type: "ast_grep";
  pattern: string;
  selector?: string;
  language?: string;
  strictness?: AstGrepStrictness;
  expect?: GuardrailMatcherExpectation;
};

export type SemgrepContentMatcher = {
  type: "semgrep";
  configs: string[];
  severity?: SemgrepSeverity[];
  include_rule_ids?: string[];
  exclude_rule_ids?: string[];
  timeout_s?: number;
  expect?: GuardrailMatcherExpectation;
};

export type GuardrailContentMatcher = AstGrepContentMatcher | SemgrepContentMatcher;

export type GuardrailRule = {
  id: string;
  description?: string;
  severity?: GuardrailSeverity;
  match: string[];
  tools_include?: string[];
  tools_exclude?: string[];
  content?: GuardrailContentMatcher[];
  content_mode?: "any" | "all";
  scope?: GuardrailContentScope;
  actions: GuardrailAction[];
};

export type GuardrailPolicyConfig = {
  version: 1;
  plugins?: string[];
  includes?: string[];
  rules: GuardrailRule[];
};

export type ContentMatchRunner = (params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
}) => Promise<boolean>;

export type LineRange = {
  startLine: number;
  endLine: number;
};

export type GuardrailChangeTarget = {
  normalizedPath: string;
  changedLineRanges?: LineRange[];
  deletedLineRanges?: LineRange[];
  beforeContent?: string | null;
};

type GuardrailMatcherSnippet = {
  source: "after" | "before";
  baseLine: number;
  range: LineRange;
  content: string;
};

type ChangeDeltaRanges = {
  addedAfterLineRanges: LineRange[];
  deletedBeforeLineRanges: LineRange[];
};

type ChangedLineSnippetPlan =
  | {
      mode: "snippets";
      snippets: GuardrailMatcherSnippet[];
    }
  | {
      mode: "full_file";
      reason:
        | "empty_after_content"
        | "too_many_windows"
        | "window_too_large"
        | "coverage_too_large";
    };

type SnippetOnlyPlan = Extract<ChangedLineSnippetPlan, { mode: "snippets" }>;

type ContentMatchRegionRunner = (params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
  snippet?: GuardrailMatcherSnippet;
}) => Promise<LineRange[]>;

type PolicyLoadContext = {
  rootDir: string;
  home?: string;
  scope: "global" | "project";
};

const PROJECT_GROUNDWORK_CONFIG_FILE = "groundwork.toml";
const PROJECT_GROUNDWORK_CONFIG_DIR = ".groundwork";
const GLOBAL_GROUNDWORK_CONFIG_DIR = ".groundwork";
const AST_GREP_STRICTNESS = new Set<AstGrepStrictness>([
  "cst",
  "smart",
  "ast",
  "relaxed",
  "signature",
  "template",
]);
const SEMGREP_SEVERITY = new Set<SemgrepSeverity>(["INFO", "WARNING", "ERROR"]);
const GUARDRAIL_SEVERITY = new Set<GuardrailSeverity>(["advisory", "warn", "block", "terminate"]);
const MATCHER_EXPECTATION = new Set<GuardrailMatcherExpectation>(["present", "absent"]);
const SKILL_ENFORCEMENT_MODE = new Set<GuardrailSkillEnforcementMode>(["prompt", "block"]);
const CONTENT_SCOPE = new Set<GuardrailContentScope>(["changed_lines", "full_file"]);
const PATCH_TEXT_KEYS = new Set(["patchtext", "patch_text", "patch"]);
const MAX_PATCH_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_PATCH_HEADER_PATHS = 4096;
const MAX_PATCH_PATH_LENGTH = 4096;
const CHANGED_LINE_WINDOW_PADDING = 12;
const MAX_SNIPPET_WINDOWS = 8;
const MAX_SNIPPET_WINDOW_LINES = 160;
const MAX_SNIPPET_TOTAL_LINES = 480;
const MAX_SNIPPET_COVERAGE_RATIO = 0.6;
const MATCHER_CONCURRENCY = 50;

async function runBoundedEffect<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
  concurrency = MATCHER_CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = [];
  results.length = items.length;
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        try {
          results[currentIndex] = await run(items[currentIndex]!);
        } catch (error) {
          throw toError(error);
        }
      }
    }),
  );

  return results;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function firstConfiguredEnv(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function resolveEnvPath(configured: string, baseDir: string | undefined): string {
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return baseDir ? path.resolve(baseDir, configured) : path.resolve(configured);
}

function listTomlFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isAutoPolicyTomlFile(entry.name))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (code === "ENOENT") return [];
    throw error;
  }
}

function isAutoPolicyTomlFile(fileName: string): boolean {
  if (!fileName.endsWith(".toml")) return false;
  if (fileName.startsWith(".")) return false;
  if (/^groundwork-[^.]+\.toml$/.test(fileName)) return false;
  return true;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    output.push(candidate);
  }
  return output;
}

function pathExists(candidate: string): boolean {
  return existsSync(candidate);
}

export const DEFAULT_EDIT_FOCUSED_TOOLS = [
  "edit",
  "write",
  "patch",
  "apply_patch",
  "edit_file",
  "morph-mcp_edit_file",
] as const;

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

export function resolveProjectPolicyConfigPath(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveProjectPolicyConfigPaths(rootDir, env)[0]!;
}

export function resolveGlobalPolicyConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveGlobalPolicyConfigPaths(env)[0] ?? null;
}

export const resolvePolicyConfigPath = resolveProjectPolicyConfigPath;

export function resolveProjectPolicyConfigPaths(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = firstConfiguredEnv(env.GROUNDWORK_POLICY_CONFIG);
  if (configured) {
    return [resolveEnvPath(configured, rootDir)];
  }

  const groundworkRootConfig = path.join(rootDir, PROJECT_GROUNDWORK_CONFIG_FILE);
  const groundworkDir = path.join(rootDir, PROJECT_GROUNDWORK_CONFIG_DIR);
  const groundworkDirConfigs = listTomlFiles(groundworkDir);
  const groundworkConfigs = uniquePaths([groundworkRootConfig, ...groundworkDirConfigs]).filter(
    pathExists,
  );
  if (groundworkConfigs.length > 0) {
    return groundworkConfigs;
  }

  return [groundworkRootConfig];
}

export function resolveGlobalPolicyConfigPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = firstConfiguredEnv(env.GROUNDWORK_POLICY_GLOBAL_CONFIG);
  if (configured) {
    return [resolveEnvPath(configured, env.HOME)];
  }

  const home = env.HOME;
  if (!home) return [];

  const groundworkDir = path.join(home, GLOBAL_GROUNDWORK_CONFIG_DIR);
  const groundworkRootConfig = path.join(groundworkDir, PROJECT_GROUNDWORK_CONFIG_FILE);
  const groundworkDirConfigs = listTomlFiles(groundworkDir);
  const groundworkConfigs = uniquePaths([groundworkRootConfig, ...groundworkDirConfigs]).filter(
    pathExists,
  );
  if (groundworkConfigs.length > 0) {
    return groundworkConfigs;
  }

  return [groundworkRootConfig];
}

export async function loadPolicyConfig(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ config: GuardrailPolicyConfig | null; path: string }> {
  const configPaths = resolveProjectPolicyConfigPaths(rootDir, env);
  const { config } = await loadPolicyConfigFromPaths(configPaths, {
    rootDir,
    home: env.HOME,
    scope: "project",
  });
  return { config, path: configPaths[0]! };
}

export async function loadMergedPolicyConfig(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  config: GuardrailPolicyConfig | null;
  projectPath: string;
  globalPath: string | null;
  projectPaths: string[];
  globalPaths: string[];
  sourceCount: number;
}> {
  const projectPaths = resolveProjectPolicyConfigPaths(rootDir, env);
  const globalPaths = resolveGlobalPolicyConfigPaths(env);
  const projectPath = projectPaths[0]!;
  const globalPath = globalPaths[0] ?? null;
  const projectPathSet = new Set(projectPaths.map((configPath) => path.resolve(configPath)));
  const distinctGlobalPaths = globalPaths.filter(
    (configPath) => !projectPathSet.has(path.resolve(configPath)),
  );

  const globalResult = await loadPolicyConfigFromPaths(distinctGlobalPaths, {
    rootDir,
    home: env.HOME,
    scope: "global",
  });
  const projectResult = await loadPolicyConfigFromPaths(projectPaths, {
    rootDir,
    home: env.HOME,
    scope: "project",
  });

  const sourceCount = globalResult.sourceCount + projectResult.sourceCount;
  return {
    config: mergePolicyConfigs(globalResult.config, projectResult.config),
    projectPath,
    globalPath,
    projectPaths,
    globalPaths,
    sourceCount,
  };
}

async function loadPolicyConfigFromPaths(
  configPaths: readonly string[],
  context: PolicyLoadContext,
): Promise<{ config: GuardrailPolicyConfig | null; sourceCount: number }> {
  let merged: GuardrailPolicyConfig | null = null;
  let sourceCount = 0;
  for (const configPath of uniquePaths(configPaths)) {
    const config = await loadPolicyConfigFromPath(configPath, context);
    if (!config) continue;
    merged = mergePolicyConfigs(merged, config);
    sourceCount += 1;
  }
  return { config: merged, sourceCount };
}

export function mergePolicyConfigs(
  globalConfig: GuardrailPolicyConfig | null,
  projectConfig: GuardrailPolicyConfig | null,
): GuardrailPolicyConfig | null {
  if (!globalConfig && !projectConfig) return null;

  const ordered: GuardrailRule[] = [];
  const indexById = new Map<string, number>();

  const appendConfig = (config: GuardrailPolicyConfig | null) => {
    if (!config) return;
    for (const rule of config.rules) {
      const existing = indexById.get(rule.id);
      if (existing === undefined) {
        indexById.set(rule.id, ordered.length);
        ordered.push(rule);
        continue;
      }

      ordered[existing] = rule;
    }
  };

  appendConfig(globalConfig);
  appendConfig(projectConfig);

  return {
    version: 1,
    rules: ordered,
  };
}

async function loadPolicyConfigFromPath(
  configPath: string,
  context: PolicyLoadContext,
  ancestry: string[] = [],
): Promise<GuardrailPolicyConfig | null> {
  const resolvedPath = path.resolve(configPath);
  const cycleIndex = ancestry.indexOf(resolvedPath);
  if (cycleIndex >= 0) {
    const cycle = [...ancestry.slice(cycleIndex), resolvedPath].join(" -> ");
    throw new Error(`Policy include cycle detected: ${cycle}`);
  }

  let parsedConfig: GuardrailPolicyConfig;
  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const parsed = parseToml(raw);
    parsedConfig = parsePolicyConfig(parsed);
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";

    if (code === "ENOENT") {
      return null;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load policy config at '${resolvedPath}': ${message}`);
  }

  const plugins = parsedConfig.plugins ?? [];
  const includes = parsedConfig.includes ?? [];
  if (plugins.length === 0 && includes.length === 0) {
    return { version: 1, rules: parsedConfig.rules };
  }

  const pluginPaths = await resolvePolicyPluginPaths(resolvedPath, plugins, context);
  const includePaths = await resolveIncludedPolicyPaths(resolvedPath, includes);
  const sourceRules: Array<{ source: string; rules: GuardrailRule[] }> = [];

  for (const pluginPath of pluginPaths) {
    const pluginConfig = await loadPolicyConfigFromPath(pluginPath, context, [
      ...ancestry,
      resolvedPath,
    ]);
    if (!pluginConfig) {
      throw new Error(`Policy plugin '${pluginPath}' was not found (from '${resolvedPath}')`);
    }

    sourceRules.push({
      source: pluginPath,
      rules: pluginConfig.rules,
    });
  }

  for (const includePath of includePaths) {
    const includedConfig = await loadPolicyConfigFromPath(includePath, context, [
      ...ancestry,
      resolvedPath,
    ]);
    if (!includedConfig) {
      throw new Error(
        `Included policy file '${includePath}' was not found (from '${resolvedPath}')`,
      );
    }

    sourceRules.push({
      source: includePath,
      rules: includedConfig.rules,
    });
  }

  sourceRules.push({
    source: resolvedPath,
    rules: parsedConfig.rules,
  });

  return {
    version: 1,
    rules: mergeRulesWithDuplicateCheck(sourceRules),
  };
}

export function parsePolicyConfig(value: unknown): GuardrailPolicyConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Policy config must be an object");
  }

  const raw = value as {
    version?: unknown;
    plugins?: unknown;
    plugin?: unknown;
    include?: unknown;
    includes?: unknown;
    rules?: unknown;
  };
  if (raw.version !== 1) {
    throw new Error("Policy config version must be 1");
  }

  const plugins = parseIncludes(raw.plugins ?? raw.plugin);
  const includes = parseIncludes(raw.includes ?? raw.include);
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) {
    throw new Error("Policy config rules must be an array");
  }
  if (raw.rules === undefined && plugins.length === 0 && includes.length === 0) {
    throw new Error("Policy config rules must be an array");
  }

  const rawRules = raw.rules ?? [];
  const rules = rawRules.map((rule, index) => parseRule(rule, index));
  assertUniqueRuleIds(rules, "policy config");
  return { version: 1, plugins, includes, rules };
}

function parseRule(value: unknown, index: number): GuardrailRule {
  if (!value || typeof value !== "object") {
    throw new Error(`Rule at index ${index} must be an object`);
  }

  const raw = value as {
    id?: unknown;
    description?: unknown;
    severity?: unknown;
    match?: unknown;
    tools_include?: unknown;
    tools_exclude?: unknown;
    content?: unknown;
    content_mode?: unknown;
    scope?: unknown;
    actions?: unknown;
  };

  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    throw new Error(`Rule at index ${index} must define a non-empty id`);
  }
  const id = raw.id;

  const patterns = Array.isArray(raw.match) ? raw.match : [raw.match];
  const match = patterns
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (match.length === 0) {
    throw new Error(`Rule '${id}' must include at least one match pattern`);
  }

  if (!Array.isArray(raw.actions) || raw.actions.length === 0) {
    throw new Error(`Rule '${id}' must include at least one action`);
  }

  const rawContentEntries =
    raw.content === undefined ? [] : Array.isArray(raw.content) ? raw.content : [raw.content];
  const content = rawContentEntries.map((entry, contentIndex) =>
    parseContentMatcher(id, entry, contentIndex),
  );
  assertSingleContentMatcherType(id, content);
  const contentMode = parseContentMode(id, raw.content_mode);

  if (contentMode && content.length === 0) {
    throw new Error(`Rule '${id}' sets content_mode but has no content matchers`);
  }

  return {
    id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    severity: parseRuleSeverity(id, raw.severity),
    match,
    tools_include: parseToolPatterns(raw.tools_include),
    tools_exclude: parseToolPatterns(raw.tools_exclude),
    content: content.length > 0 ? content : undefined,
    content_mode: contentMode,
    scope: parseContentScope(id, raw.scope),
    actions: raw.actions.map((action, actionIndex) => parseAction(id, action, actionIndex)),
  };
}

function parseContentMatcher(
  ruleId: string,
  value: unknown,
  index: number,
): GuardrailContentMatcher {
  if (!value || typeof value !== "object") {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' must be an object`);
  }

  const raw = value as Record<string, unknown>;
  const matcherType = normalizeMatcherType(raw.type);
  if (matcherType === "ast_grep") {
    return parseAstGrepContentMatcher(ruleId, index, raw);
  }

  return parseSemgrepContentMatcher(ruleId, index, raw);
}

function normalizeMatcherType(rawType: unknown): "ast_grep" | "semgrep" {
  if (rawType === undefined) return "ast_grep";
  if (typeof rawType !== "string") {
    throw new Error("Content matcher type must be a string");
  }

  const normalized = rawType.trim().toLowerCase();
  if (["ast_grep", "ast-grep", "astgrep"].includes(normalized)) {
    return "ast_grep";
  }

  if (["semgrep", "sem-grep"].includes(normalized)) {
    return "semgrep";
  }

  throw new Error(`Unsupported content matcher type '${rawType}'`);
}

function parseAstGrepContentMatcher(
  ruleId: string,
  index: number,
  raw: Record<string, unknown>,
): AstGrepContentMatcher {
  if (typeof raw.pattern !== "string" || raw.pattern.trim().length === 0) {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' requires non-empty pattern`);
  }

  const strictness = parseStrictness(ruleId, index, raw.strictness);
  return {
    type: "ast_grep",
    pattern: raw.pattern,
    selector: parseOptionalMatcherTextField(ruleId, index, raw.selector, "selector"),
    language: typeof raw.language === "string" ? raw.language : undefined,
    strictness,
    expect: parseMatcherExpectation(ruleId, index, raw.expect),
  };
}

function parseSemgrepContentMatcher(
  ruleId: string,
  index: number,
  raw: Record<string, unknown>,
): SemgrepContentMatcher {
  const rawConfigs = raw.configs ?? raw.config;
  const configs = normalizeStringList(rawConfigs);
  if (configs.length === 0) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' requires non-empty configs for semgrep`,
    );
  }

  const severity = parseSemgrepSeverity(ruleId, index, raw.severity);

  return {
    type: "semgrep",
    configs,
    severity,
    include_rule_ids: normalizeStringList(raw.include_rule_ids ?? raw.include_rules),
    exclude_rule_ids: normalizeStringList(raw.exclude_rule_ids ?? raw.exclude_rules),
    timeout_s: parsePositiveNumber(ruleId, index, raw.timeout_s, "timeout_s"),
    expect: parseMatcherExpectation(ruleId, index, raw.expect),
  };
}

function assertSingleContentMatcherType(ruleId: string, content: GuardrailContentMatcher[]): void {
  if (content.length <= 1) return;

  const matcherTypes = new Set(content.map((matcher) => matcher.type));
  if (matcherTypes.size > 1) {
    throw new Error(
      `Rule '${ruleId}' mixes content matcher types; split into separate rules per matcher type`,
    );
  }
}

function parseIncludes(value: unknown): string[] {
  if (value === undefined) return [];
  const entries = Array.isArray(value) ? value : [value];
  const includes: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error("Policy config include paths must be non-empty strings");
    }

    includes.push(entry.trim());
  }

  return includes;
}

function assertUniqueRuleIds(rules: GuardrailRule[], context: string): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new Error(`Duplicate rule id '${rule.id}' in ${context}`);
    }
    seen.add(rule.id);
  }
}

function normalizeStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseOptionalMatcherTextField(
  ruleId: string,
  index: number,
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid ${fieldName}`);
  }

  return value.trim();
}

function parseToolPatterns(value: unknown): string[] | undefined {
  const patterns = normalizeStringList(value);
  return patterns.length > 0 ? patterns : undefined;
}

function parseSemgrepSeverity(
  ruleId: string,
  index: number,
  value: unknown,
): SemgrepSeverity[] | undefined {
  if (value === undefined) return undefined;
  const rawValues = Array.isArray(value) ? value : [value];
  const severities: SemgrepSeverity[] = [];

  for (const rawSeverity of rawValues) {
    if (typeof rawSeverity !== "string") {
      throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid severity value`);
    }

    const normalized = rawSeverity.trim().toUpperCase() as SemgrepSeverity;
    if (!SEMGREP_SEVERITY.has(normalized)) {
      throw new Error(
        `Content matcher ${index} in rule '${ruleId}' has unsupported severity '${rawSeverity}'`,
      );
    }

    severities.push(normalized);
  }

  return severities.length > 0 ? severities : undefined;
}

function parsePositiveNumber(
  ruleId: string,
  index: number,
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' has invalid positive number for ${field}`,
    );
  }

  return value;
}

function parseStrictness(
  ruleId: string,
  index: number,
  value: unknown,
): AstGrepStrictness | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid strictness`);
  }

  const normalized = value.trim().toLowerCase() as AstGrepStrictness;
  if (!AST_GREP_STRICTNESS.has(normalized)) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' has unsupported strictness '${value}'`,
    );
  }

  return normalized;
}

function parseMatcherExpectation(
  ruleId: string,
  index: number,
  value: unknown,
): GuardrailMatcherExpectation | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid expect value`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailMatcherExpectation;
  if (!MATCHER_EXPECTATION.has(normalized)) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' has unsupported expect '${value}'`,
    );
  }

  return normalized;
}

function parseContentMode(ruleId: string, value: unknown): "any" | "all" | undefined {
  if (value === undefined) return undefined;
  if (value === "any" || value === "all") return value;
  throw new Error(`Rule '${ruleId}' has invalid content_mode '${String(value)}'`);
}

function parseContentScope(ruleId: string, value: unknown): GuardrailContentScope | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Rule '${ruleId}' has invalid scope value`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailContentScope;
  if (!CONTENT_SCOPE.has(normalized)) {
    throw new Error(`Rule '${ruleId}' has unsupported scope '${value}'`);
  }

  return normalized;
}

function parseRuleSeverity(ruleId: string, value: unknown): GuardrailSeverity | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Rule '${ruleId}' has invalid severity value`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailSeverity;
  if (!GUARDRAIL_SEVERITY.has(normalized)) {
    throw new Error(`Rule '${ruleId}' has unsupported severity '${value}'`);
  }

  return normalized;
}

function parseAction(ruleId: string, value: unknown, index: number): GuardrailAction {
  if (!value || typeof value !== "object") {
    throw new Error(`Action ${index} in rule '${ruleId}' must be an object`);
  }

  const raw = value as {
    type?: unknown;
    text?: unknown;
    once_per_session?: unknown;
    message?: unknown;
    skills?: unknown;
    mode?: unknown;
  };

  if (raw.type === "inject_prompt") {
    if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
      throw new Error(`inject_prompt action in rule '${ruleId}' requires non-empty text`);
    }

    return {
      type: "inject_prompt",
      text: raw.text,
      once_per_session: raw.once_per_session === true,
    };
  }

  if (raw.type === "block_tool") {
    return {
      type: "block_tool",
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  }

  if (raw.type === "require_human_override") {
    return {
      type: "require_human_override",
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  }

  if (raw.type === "stop_session") {
    return {
      type: "stop_session",
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  }

  if (raw.type === "ensure_skill_loaded") {
    const skills = normalizeStringList(raw.skills);
    if (skills.length === 0) {
      throw new Error(`ensure_skill_loaded action in rule '${ruleId}' requires non-empty skills`);
    }

    const mode = parseSkillEnforcementMode(ruleId, index, raw.mode);
    return {
      type: "ensure_skill_loaded",
      skills,
      mode,
      message: typeof raw.message === "string" ? raw.message : undefined,
      once_per_session: raw.once_per_session === true,
    };
  }

  throw new Error(`Unsupported action type in rule '${ruleId}' at index ${index}`);
}

function parseSkillEnforcementMode(
  ruleId: string,
  index: number,
  value: unknown,
): GuardrailSkillEnforcementMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Action ${index} in rule '${ruleId}' has invalid mode`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailSkillEnforcementMode;
  if (!SKILL_ENFORCEMENT_MODE.has(normalized)) {
    throw new Error(`Action ${index} in rule '${ruleId}' has unsupported mode '${value}'`);
  }

  return normalized;
}

export function extractCandidatePaths(args: unknown): string[] {
  const results = new Set<string>();
  collectPaths(args, results, []);
  return Array.from(results);
}

export function extractChangeTargets(rootDir: string, args: unknown): GuardrailChangeTarget[] {
  const results = new Map<string, GuardrailChangeTarget>();
  collectChangeTargets(rootDir, args, results, []);
  return Array.from(results.values());
}

function collectPaths(value: unknown, out: Set<string>, keyPath: string[]): void {
  if (typeof value === "string") {
    const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? "";
    if (PATCH_TEXT_KEYS.has(key)) {
      for (const patchPath of extractPathsFromPatchText(value)) {
        out.add(patchPath);
      }
      return;
    }

    if (looksLikePath(value, key)) {
      out.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, out, keyPath);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    collectPaths(entry, out, [...keyPath, key]);
  }
}

function collectChangeTargets(
  rootDir: string,
  value: unknown,
  out: Map<string, GuardrailChangeTarget>,
  keyPath: string[],
): void {
  if (typeof value === "string") {
    const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? "";
    if (PATCH_TEXT_KEYS.has(key)) {
      for (const target of extractTargetsFromPatchText(rootDir, value)) {
        mergeChangeTarget(out, target);
      }
      return;
    }

    if (looksLikePath(value, key)) {
      mergeChangeTarget(out, {
        normalizedPath: normalizePathForMatching(rootDir, value),
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangeTargets(rootDir, entry, out, keyPath);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    collectChangeTargets(rootDir, entry, out, [...keyPath, key]);
  }
}

function mergeChangeTarget(
  out: Map<string, GuardrailChangeTarget>,
  incoming: GuardrailChangeTarget,
): void {
  const existing = out.get(incoming.normalizedPath);
  if (!existing) {
    out.set(incoming.normalizedPath, {
      normalizedPath: incoming.normalizedPath,
      beforeContent: incoming.beforeContent,
      changedLineRanges: cloneLineRanges(incoming.changedLineRanges),
      deletedLineRanges: cloneLineRanges(incoming.deletedLineRanges),
    });
    return;
  }

  out.set(incoming.normalizedPath, {
    normalizedPath: incoming.normalizedPath,
    beforeContent: existing.beforeContent ?? incoming.beforeContent,
    changedLineRanges: mergeLineRanges(existing.changedLineRanges, incoming.changedLineRanges),
    deletedLineRanges: mergeLineRanges(existing.deletedLineRanges, incoming.deletedLineRanges),
  });
}

function cloneLineRanges(ranges: LineRange[] | undefined): LineRange[] | undefined {
  return ranges?.map((range) => ({ ...range }));
}

function mergeLineRanges(
  left: LineRange[] | undefined,
  right: LineRange[] | undefined,
): LineRange[] | undefined {
  const combined = [...(left ?? []), ...(right ?? [])]
    .map((range) => ({ ...range }))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  if (combined.length === 0) return undefined;

  const merged: LineRange[] = [combined[0]!];
  for (const current of combined.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (current.startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, current.endLine);
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function extractPathsFromPatchText(patchText: string): string[] {
  if (patchText.length > MAX_PATCH_TEXT_BYTES) {
    throw new Error(`Patch text exceeds safe inspection size (${MAX_PATCH_TEXT_BYTES} bytes)`);
  }

  const results: string[] = [];

  for (const rawLine of patchText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const fileMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (fileMatch?.[1]) {
      const patchPath = fileMatch[1].trim();
      if (!isSafePatchPath(patchPath)) {
        continue;
      }

      results.push(patchPath);
      if (results.length > MAX_PATCH_HEADER_PATHS) {
        throw new Error(`Patch text references too many paths (${MAX_PATCH_HEADER_PATHS} max)`);
      }
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch?.[1]) {
      const patchPath = moveMatch[1].trim();
      if (!isSafePatchPath(patchPath)) {
        continue;
      }

      results.push(patchPath);
      if (results.length > MAX_PATCH_HEADER_PATHS) {
        throw new Error(`Patch text references too many paths (${MAX_PATCH_HEADER_PATHS} max)`);
      }
    }
  }

  return results.filter((entry) => entry.length > 0);
}

function extractTargetsFromPatchText(rootDir: string, patchText: string): GuardrailChangeTarget[] {
  if (patchText.length > MAX_PATCH_TEXT_BYTES) {
    throw new Error(`Patch text exceeds safe inspection size (${MAX_PATCH_TEXT_BYTES} bytes)`);
  }

  const results = new Map<string, GuardrailChangeTarget>();
  let currentPath: string | null = null;
  let currentAddedLines: number[] = [];
  let currentDeletedLines: number[] = [];
  let currentBeforeLine: number | null = null;
  let currentAfterLine: number | null = null;

  const flushCurrent = () => {
    if (!currentPath) return;
    mergeChangeTarget(results, {
      normalizedPath: normalizePathForMatching(rootDir, currentPath),
      changedLineRanges: collapseLineNumbers(currentAddedLines),
      deletedLineRanges: collapseLineNumbers(currentDeletedLines),
    });
    currentPath = null;
    currentAddedLines = [];
    currentDeletedLines = [];
    currentBeforeLine = null;
    currentAfterLine = null;
  };

  for (const rawLine of patchText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const fileMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (fileMatch?.[1]) {
      flushCurrent();
      const patchPath = fileMatch[1].trim();
      if (!isSafePatchPath(patchPath)) {
        currentPath = null;
        currentAddedLines = [];
        currentDeletedLines = [];
        currentBeforeLine = null;
        currentAfterLine = null;
        continue;
      }

      currentPath = patchPath;
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch?.[1]) {
      const patchPath = moveMatch[1].trim();
      if (!isSafePatchPath(patchPath)) {
        currentPath = null;
        currentAddedLines = [];
        currentDeletedLines = [];
        currentBeforeLine = null;
        currentAfterLine = null;
        continue;
      }

      currentPath = patchPath;
      continue;
    }

    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch?.[1] || !currentPath) {
      if (currentBeforeLine === null || currentAfterLine === null) {
        continue;
      }

      if (rawLine.startsWith("+")) {
        currentAddedLines.push(currentAfterLine);
        currentAfterLine += 1;
        continue;
      }

      if (rawLine.startsWith("-")) {
        currentDeletedLines.push(currentBeforeLine);
        currentBeforeLine += 1;
        continue;
      }

      if (rawLine.startsWith(" ")) {
        currentBeforeLine += 1;
        currentAfterLine += 1;
        continue;
      }

      if (rawLine.startsWith("\\")) {
        continue;
      }

      currentBeforeLine = null;
      currentAfterLine = null;
      continue;
    }

    currentBeforeLine = Number(rawLine.match(/^@@ -(\d+)/)?.[1] ?? 0);
    currentAfterLine = Number(hunkMatch[1]);
  }

  flushCurrent();
  return Array.from(results.values());
}

function isSafePatchPath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PATCH_PATH_LENGTH) {
    return false;
  }

  return !/[\r\n]/.test(value) && !value.includes("\0");
}

function looksLikePath(value: string, keyName: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  if (/[\r\n]/.test(normalized)) return false;

  const pathKeys = ["filepath", "path", "paths", "dir", "directory", "cwd", "workdir"];
  if (pathKeys.includes(keyName)) return true;

  if (normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../")) {
    return true;
  }

  return /[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+/.test(normalized);
}

export function normalizePathForMatching(rootDir: string, target: string): string {
  const absolute = path.isAbsolute(target) ? target : path.resolve(rootDir, target);
  const relative = path.relative(rootDir, absolute);
  const withoutLeading = relative.startsWith(`..${path.sep}`) ? absolute : relative;
  return withoutLeading.split(path.sep).join("/");
}

export function findMatchingRules(
  config: GuardrailPolicyConfig,
  normalizedPaths: string[],
): GuardrailRule[] {
  if (normalizedPaths.length === 0) return [];

  return config.rules.filter((rule) =>
    normalizedPaths.some((target) => ruleMatchesPath(rule, target)),
  );
}

export function ruleMatchesPath(rule: GuardrailRule, normalizedPath: string): boolean {
  return rule.match.some((pattern) => globMatch(pattern, normalizedPath));
}

export function ruleMatchesTool(rule: GuardrailRule, tool: string): boolean {
  const include = rule.tools_include ?? [...DEFAULT_EDIT_FOCUSED_TOOLS];
  if (!toolMatchesPatterns(include, tool)) {
    return false;
  }

  const exclude = rule.tools_exclude ?? [];
  return !toolMatchesPatterns(exclude, tool);
}

export function resolveRuleScope(rule: GuardrailRule): GuardrailContentScope {
  if (!rule.content || rule.content.length === 0) {
    return rule.scope ?? "full_file";
  }

  return rule.scope ?? "changed_lines";
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

function evaluateMatcherExpectation(matcher: GuardrailContentMatcher, matched: boolean): boolean {
  const expect = matcher.expect ?? "present";
  return expect === "absent" ? !matched : matched;
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
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[]> {
  if (params.matcher.type === "semgrep") {
    return runSemgrepMatcherRegions(params);
  }

  return runAstGrepMatcherRegions(params);
}

export async function runAstGrepMatcher(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
}): Promise<boolean> {
  const regions = await runAstGrepMatcherRegions(params);
  return regions.length > 0;
}

async function runAstGrepMatcherRegions(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[]> {
  const { filePath, matcher, snippet } = params;
  if (matcher.type !== "ast_grep") {
    throw new Error(`Unsupported ast-grep matcher type '${String(matcher.type)}'`);
  }

  const batch = await runAstGrepMatcherBatchRegions({
    filePath,
    entries: [{ index: 0, matcher }],
    snippet,
  });
  return batch[0] ?? [];
}

export async function runSemgrepMatcher(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
}): Promise<boolean> {
  const regions = await runSemgrepMatcherRegions(params);
  return regions.length > 0;
}

async function runSemgrepMatcherRegions(params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[]> {
  const { rootDir, filePath, matcher, snippet } = params;
  if (matcher.type !== "semgrep") {
    throw new Error(`Unsupported semgrep matcher type '${String(matcher.type)}'`);
  }

  const batch = await runSemgrepMatcherBatchRegions({
    rootDir,
    filePath,
    entries: [{ index: 0, matcher }],
    snippet,
  });
  return batch[0] ?? [];
}

async function runNativeMatcherBatchRegionsForSource(params: {
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

async function runAstGrepMatcherBatchRegions(params: {
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

async function runSemgrepMatcherBatchRegions(params: {
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
  const matched = await runBoundedEffect(targets, async (target) => {
    const normalizedPath = target.normalizedPath;
    const filePath = path.isAbsolute(normalizedPath)
      ? normalizedPath
      : path.resolve(rootDir, normalizedPath);
    const afterContent = await readFileText(filePath);
    const delta = computeChangeDeltaRangesFromContents(target.beforeContent ?? null, afterContent);
    const changedLines =
      target.changedLineRanges && target.changedLineRanges.length > 0
        ? target.changedLineRanges
        : delta.addedAfterLineRanges;
    const deletedLines =
      target.deletedLineRanges && target.deletedLineRanges.length > 0
        ? target.deletedLineRanges
        : delta.deletedBeforeLineRanges;
    if (changedLines.length === 0 && deletedLines.length === 0) return null;

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

    const afterRegions =
      afterSnippetPlan === null
        ? matchers.map(() => [] as LineRange[])
        : await runMatcherBatchRegionsForPlan({
            rootDir,
            filePath,
            matchers,
            regionRunner,
            snippetPlan: afterSnippetPlan,
          });

    const presentMatchers = matchers.flatMap((matcher, index) =>
      (matcher.expect ?? "present") === "absent" ? [] : [{ matcher, index }],
    );
    const beforeRegions =
      beforeSnippetPlan === null || presentMatchers.length === 0
        ? []
        : await runMatcherBatchRegionsForPlan({
            rootDir,
            filePath,
            matchers: presentMatchers.map((entry) => entry.matcher),
            regionRunner,
            snippetPlan: beforeSnippetPlan,
          });

    const beforeByIndex = new Map<number, LineRange[]>();
    for (const [offset, entry] of presentMatchers.entries()) {
      beforeByIndex.set(entry.index, beforeRegions[offset] ?? []);
    }

    const checks = matchers.map((matcher, index) => {
      const afterPresence = (afterRegions[index] ?? []).some((region) =>
        rangesOverlap(region, changedLines),
      );
      const beforePresence =
        (matcher.expect ?? "present") === "absent"
          ? false
          : (beforeByIndex.get(index) ?? []).some((region) => rangesOverlap(region, deletedLines));

      return evaluateMatcherExpectation(matcher, afterPresence || beforePresence);
    });

    const isMatch = mode === "all" ? checks.every(Boolean) : checks.some(Boolean);
    return isMatch ? normalizedPath : null;
  });

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

async function runMatcherBatchRegionsForPlan(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  regionRunner: ContentMatchRegionRunner;
  snippetPlan: ChangedLineSnippetPlan;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, regionRunner, snippetPlan } = params;
  if (snippetPlan.mode === "full_file") {
    return runMatcherBatchRegionsForSource({
      rootDir,
      filePath,
      matchers,
      regionRunner,
    });
  }

  try {
    return regionRunner === runContentMatcherRegions
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
    });
  }
}

async function runMatcherBatchRegionsForSource(params: {
  rootDir: string;
  filePath: string;
  matchers: GuardrailContentMatcher[];
  regionRunner: ContentMatchRegionRunner;
  snippet?: GuardrailMatcherSnippet;
}): Promise<LineRange[][]> {
  const { rootDir, filePath, matchers, regionRunner, snippet } = params;
  if (regionRunner === runContentMatcherRegions) {
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

function buildChangedLineSnippetPlan(params: {
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

async function readFileText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function computeChangeDeltaRangesFromContents(
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

function collapseLineNumbers(lineNumbers: number[]): LineRange[] {
  if (lineNumbers.length === 0) return [];

  const ranges: LineRange[] = [];
  let start = lineNumbers[0]!;
  let end = start;

  for (let index = 1; index < lineNumbers.length; index += 1) {
    const current = lineNumbers[index]!;
    if (current === end + 1) {
      end = current;
      continue;
    }

    ranges.push({ startLine: start, endLine: end });
    start = current;
    end = current;
  }

  ranges.push({ startLine: start, endLine: end });
  return ranges;
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

function rangesOverlap(range: LineRange, targets: LineRange[]): boolean {
  return targets.some(
    (target) => range.startLine <= target.endLine && target.startLine <= range.endLine,
  );
}

function mapSnippetRegions(
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

async function runMatcherCliAgainstSource(params: {
  filePath: string;
  snippet?: GuardrailMatcherSnippet;
  run: (sourcePath: string) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { filePath, snippet, run } = params;
  if (!snippet) {
    return run(filePath);
  }

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "groundwork-policy-snippet-"),
  );
  const tempFilePath = path.join(tempDir, path.basename(filePath));

  try {
    await fs.writeFile(tempFilePath, snippet.content, "utf8");
    return await run(tempFilePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function spawnProcess(params: {
  cmd: string[];
  stdinText?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const [command, ...args] = params.cmd;
  if (!command) {
    throw new Error("Missing command");
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(command, args, {
      stdio: [params.stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    if (params.stdinText !== undefined && child.stdin) {
      child.stdin.setDefaultEncoding("utf8");
      child.stdin.end(params.stdinText);
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function inferAstGrepLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_AST_GREP_LANGUAGE.get(ext);
}

function resolveConfigPath(rootDir: string, rawPath: string): string {
  if (rawPath.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) {
      return rawPath;
    }

    return path.join(home, rawPath.slice(2));
  }

  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  return path.resolve(rootDir, rawPath);
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveIncludedPolicyPaths(
  configPath: string,
  includes: string[],
): Promise<string[]> {
  const configDir = path.dirname(configPath);
  const resolved = new Set<string>();

  for (const include of includes) {
    const resolvedInclude = resolveIncludePath(configDir, include);
    const hasWildcard = includeHasWildcard(resolvedInclude);

    if (!hasWildcard) {
      resolved.add(path.resolve(resolvedInclude));
      continue;
    }

    const matched = await expandIncludePattern(resolvedInclude);
    if (matched.length === 0) {
      throw new Error(`Include pattern '${include}' in '${configPath}' matched no files`);
    }

    for (const entry of matched) {
      resolved.add(path.resolve(entry));
    }
  }

  return Array.from(resolved).sort();
}

async function resolvePolicyPluginPaths(
  configPath: string,
  plugins: string[],
  context: PolicyLoadContext,
): Promise<string[]> {
  const resolved = new Set<string>();
  for (const plugin of plugins) {
    const pluginPaths = await resolvePolicyPluginPath(configPath, plugin, context);
    for (const pluginPath of pluginPaths) {
      resolved.add(path.resolve(pluginPath));
    }
  }

  return Array.from(resolved);
}

async function resolvePolicyPluginPath(
  configPath: string,
  plugin: string,
  context: PolicyLoadContext,
): Promise<string[]> {
  const trimmed = plugin.trim();
  if (trimmed.length === 0) return [];

  if (isPolicyPathReference(trimmed)) {
    return resolvePolicyPluginPathReferences(configPath, [trimmed], context);
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed)) {
    throw new Error(`Invalid policy plugin name '${plugin}' in '${configPath}'`);
  }

  const candidates = uniquePaths(policyPluginCandidates(configPath, trimmed, context));
  for (const candidate of candidates) {
    if (await isRegularFile(candidate)) {
      return [candidate];
    }
  }

  throw new Error(
    `Policy plugin '${plugin}' was not found from '${configPath}'. Checked: ${candidates.join(", ")}`,
  );
}

function isPolicyPathReference(value: string): boolean {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    value.endsWith(".toml") ||
    includeHasWildcard(value)
  );
}

function policyPluginCandidates(
  configPath: string,
  pluginName: string,
  context: PolicyLoadContext,
): string[] {
  const configDir = path.dirname(configPath);
  const names = [`.${pluginName}.toml`, `${pluginName}.toml`];
  const candidates: string[] = [];

  const pushUnder = (directory: string) => {
    for (const name of names) {
      candidates.push(path.join(directory, name));
    }
    for (const name of names) {
      candidates.push(path.join(directory, "plugins", name));
    }
  };

  if (path.basename(configDir) === PROJECT_GROUNDWORK_CONFIG_DIR) {
    pushUnder(configDir);
  }

  if (context.scope === "project") {
    pushUnder(path.join(context.rootDir, PROJECT_GROUNDWORK_CONFIG_DIR));
  }

  if (context.home) {
    pushUnder(path.join(context.home, GLOBAL_GROUNDWORK_CONFIG_DIR));
  }

  return candidates;
}

async function resolvePolicyPluginPathReferences(
  configPath: string,
  plugins: string[],
  context: PolicyLoadContext,
): Promise<string[]> {
  const configDir = path.dirname(configPath);
  const resolved = new Set<string>();

  for (const plugin of plugins) {
    const resolvedPlugin = resolvePolicyPluginPathReference(configDir, plugin, context);
    const hasWildcard = includeHasWildcard(resolvedPlugin);

    if (!hasWildcard) {
      resolved.add(path.resolve(resolvedPlugin));
      continue;
    }

    const matched = await expandIncludePattern(resolvedPlugin);
    if (matched.length === 0) {
      throw new Error(`Policy plugin pattern '${plugin}' in '${configPath}' matched no files`);
    }

    for (const entry of matched) {
      resolved.add(path.resolve(entry));
    }
  }

  return Array.from(resolved).sort();
}

function resolvePolicyPluginPathReference(
  configDir: string,
  plugin: string,
  context: PolicyLoadContext,
): string {
  if (plugin.startsWith("~/")) {
    if (!context.home) return plugin;
    return path.join(context.home, plugin.slice(2));
  }

  if (path.isAbsolute(plugin)) {
    return plugin;
  }

  return path.resolve(configDir, plugin);
}

function resolveIncludePath(configDir: string, include: string): string {
  if (include.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) return include;
    return path.join(home, include.slice(2));
  }

  if (path.isAbsolute(include)) {
    return include;
  }

  return path.resolve(configDir, include);
}

function includeHasWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

async function expandIncludePattern(pattern: string): Promise<string[]> {
  const normalizedPattern = normalizeSlashes(path.resolve(pattern));
  const scanRoot = findPatternScanRoot(normalizedPattern);
  const candidates = await listFilesRecursive(scanRoot);

  return candidates
    .map((filePath) => normalizeSlashes(filePath))
    .filter((filePath) => globMatch(normalizedPattern, filePath))
    .sort();
}

function findPatternScanRoot(normalizedPattern: string): string {
  const wildcardIndex = normalizedPattern.search(/[*?]/);
  if (wildcardIndex < 0) {
    return path.dirname(normalizedPattern);
  }

  const lastSlashBeforeWildcard = normalizedPattern.lastIndexOf("/", wildcardIndex);
  if (lastSlashBeforeWildcard < 0) {
    return process.cwd();
  }

  const prefix = normalizedPattern.slice(0, lastSlashBeforeWildcard);
  if (prefix.length === 0) {
    return path.sep;
  }

  return prefix;
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function mergeRulesWithDuplicateCheck(
  sources: Array<{ source: string; rules: GuardrailRule[] }>,
): GuardrailRule[] {
  const merged: GuardrailRule[] = [];
  const seen = new Map<string, string>();

  for (const source of sources) {
    for (const rule of source.rules) {
      const existingSource = seen.get(rule.id);
      if (existingSource) {
        throw new Error(
          `Duplicate rule id '${rule.id}' found in '${source.source}' and '${existingSource}'`,
        );
      }

      seen.set(rule.id, source.source);
      merged.push(rule);
    }
  }

  return merged;
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join("/");
}

function globMatch(pattern: string, target: string): boolean {
  const source = `^${globToRegexSource(pattern)}$`;
  return new RegExp(source).test(target);
}

function toolMatchesPatterns(patterns: string[], tool: string): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((pattern) => pattern === "*" || globMatch(pattern, tool));
}

function globToRegexSource(pattern: string): string {
  const normalized = pattern.split(path.sep).join("/");
  let output = "";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i] ?? "";
    const next = normalized[i + 1] ?? "";
    const nextTwo = normalized[i + 2] ?? "";

    if (char === "*" && next === "*" && nextTwo === "/") {
      output += "(?:.*/)?";
      i += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      output += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      output += "[^/]*";
      continue;
    }

    if (char === "?") {
      output += "[^/]";
      continue;
    }

    output += escapeRegex(char);
  }

  return output;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
