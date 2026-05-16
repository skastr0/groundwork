import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "@iarna/toml";
import {
  mergeRulesWithDuplicateCheck,
  type PolicyLoadContext,
  resolveIncludedPolicyPaths,
  resolvePolicyPluginPaths,
} from "./config-source-resolution.ts";
import type { GuardrailPolicyConfig, GuardrailRule } from "./config-types.ts";
import {
  resolveGlobalPolicyConfigPaths,
  resolveProjectPolicyConfigPaths,
  uniquePaths,
} from "./config-paths.ts";
import { parsePolicyConfig } from "./config-parser.ts";

type PolicySourceRules = {
  source: string;
  rules: GuardrailRule[];
};

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
  appendPolicyRules(ordered, indexById, globalConfig);
  appendPolicyRules(ordered, indexById, projectConfig);

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
  assertNoPolicyIncludeCycle(resolvedPath, ancestry);

  const parsedConfig = await readPolicyConfigFile(resolvedPath);
  if (!parsedConfig) return null;
  if (!hasReferencedPolicySources(parsedConfig)) {
    return { version: 1, rules: parsedConfig.rules };
  }

  const sourceRules = await collectReferencedPolicyRules(
    resolvedPath,
    parsedConfig,
    context,
    ancestry,
  );
  sourceRules.push({ source: resolvedPath, rules: parsedConfig.rules });

  return {
    version: 1,
    rules: mergeRulesWithDuplicateCheck(sourceRules),
  };
}

function appendPolicyRules(
  ordered: GuardrailRule[],
  indexById: Map<string, number>,
  config: GuardrailPolicyConfig | null,
): void {
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
}

function assertNoPolicyIncludeCycle(resolvedPath: string, ancestry: string[]): void {
  const cycleIndex = ancestry.indexOf(resolvedPath);
  if (cycleIndex < 0) return;

  const cycle = [...ancestry.slice(cycleIndex), resolvedPath].join(" -> ");
  throw new Error(`Policy include cycle detected: ${cycle}`);
}

async function readPolicyConfigFile(resolvedPath: string): Promise<GuardrailPolicyConfig | null> {
  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const parsed = parseToml(raw);
    return parsePolicyConfig(parsed);
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return null;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load policy config at '${resolvedPath}': ${message}`);
  }
}

function readErrorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

function hasReferencedPolicySources(config: GuardrailPolicyConfig): boolean {
  return (config.plugins?.length ?? 0) > 0 || (config.includes?.length ?? 0) > 0;
}

async function collectReferencedPolicyRules(
  resolvedPath: string,
  parsedConfig: GuardrailPolicyConfig,
  context: PolicyLoadContext,
  ancestry: string[],
): Promise<PolicySourceRules[]> {
  const sourceRules: PolicySourceRules[] = [];
  const nextAncestry = [...ancestry, resolvedPath];
  const pluginPaths = await resolvePolicyPluginPaths(
    resolvedPath,
    parsedConfig.plugins ?? [],
    context,
  );
  const includePaths = await resolveIncludedPolicyPaths(resolvedPath, parsedConfig.includes ?? []);

  for (const pluginPath of pluginPaths) {
    sourceRules.push(await loadReferencedPolicyRules(pluginPath, context, nextAncestry, "plugin"));
  }
  for (const includePath of includePaths) {
    sourceRules.push(
      await loadReferencedPolicyRules(includePath, context, nextAncestry, "include"),
    );
  }

  return sourceRules;
}

async function loadReferencedPolicyRules(
  sourcePath: string,
  context: PolicyLoadContext,
  ancestry: string[],
  kind: "plugin" | "include",
): Promise<PolicySourceRules> {
  const config = await loadPolicyConfigFromPath(sourcePath, context, ancestry);
  if (!config) {
    throw new Error(createMissingReferencedPolicyMessage(kind, sourcePath, ancestry.at(-1)!));
  }

  return {
    source: sourcePath,
    rules: config.rules,
  };
}

function createMissingReferencedPolicyMessage(
  kind: "plugin" | "include",
  sourcePath: string,
  parentPath: string,
): string {
  if (kind === "plugin") {
    return `Policy plugin '${sourcePath}' was not found (from '${parentPath}')`;
  }

  return `Included policy file '${sourcePath}' was not found (from '${parentPath}')`;
}
