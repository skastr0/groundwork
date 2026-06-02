import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  GLOBAL_GROUNDWORK_CONFIG_DIR,
  PROJECT_GROUNDWORK_CONFIG_DIR,
  PROJECT_GROUNDWORK_CONFIG_FILE,
} from "./config-source-resolution.ts";

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

export function uniquePaths(paths: readonly string[]): string[] {
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
