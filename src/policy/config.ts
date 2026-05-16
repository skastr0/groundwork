import { existsSync, promises as fs, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { isPatchTextKey, mergeChangeTarget } from "./change-targets.ts";
import {
  GLOBAL_GROUNDWORK_CONFIG_DIR,
  mergeRulesWithDuplicateCheck,
  type PolicyLoadContext,
  PROJECT_GROUNDWORK_CONFIG_DIR,
  PROJECT_GROUNDWORK_CONFIG_FILE,
  resolveIncludedPolicyPaths,
  resolvePolicyPluginPaths,
} from "./config-source-resolution.ts";
import { globMatch, toolMatchesPatterns } from "./glob.ts";
import { extractPathsFromPatchText, extractTargetsFromPatchText } from "./patch-targets.ts";
import { normalizePathForMatching } from "./paths.ts";

export { normalizePathForMatching } from "./paths.ts";
export {
  filterPathsByRuleContent,
  resolveRuleScope,
  ruleContentMatcherType,
  runAstGrepMatcher,
  runContentMatcher,
  runSemgrepMatcher,
} from "./content/index.ts";

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
    if (isPatchTextKey(key)) {
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
    if (isPatchTextKey(key)) {
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
