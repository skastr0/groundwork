import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { parsePolicyConfig } from "./config-parser.ts";
import {
  GLOBAL_GROUNDWORK_CONFIG_DIR,
  PROJECT_GROUNDWORK_CONFIG_DIR,
} from "./config-source-resolution.ts";

const SOURCE_REGISTRY_FILE = "policy.sources.json";
const LOCK_FILE = "policy.lock.json";
const SOURCE_SCHEMA_VERSION = "groundwork-policy-sources/v1";
const LOCK_SCHEMA_VERSION = "groundwork-policy-lock/v1";
const DEFAULT_REF = "HEAD";

export type PolicyPackScope = "global" | "project";

export interface PolicyPackInstallInput {
  url: string;
  ref?: string;
  name?: string;
  path?: string;
  scope?: PolicyPackScope;
  root_dir?: string;
  home?: string;
  force?: boolean;
}

export interface PolicyPackUpdateInput {
  names?: string[];
  scope?: PolicyPackScope;
  root_dir?: string;
  home?: string;
  force?: boolean;
}

export interface PolicyPackSourceEntry {
  type: "git";
  url: string;
  ref: string;
  source_path: string;
  installed_path: string;
}

export interface PolicyPackLockEntry extends PolicyPackSourceEntry {
  resolved_commit: string;
  sha256: string;
  installed_at: string;
}

interface PolicyPackSourceRegistry {
  schema_version: typeof SOURCE_SCHEMA_VERSION;
  packs: Record<string, PolicyPackSourceEntry>;
}

interface PolicyPackLock {
  schema_version: typeof LOCK_SCHEMA_VERSION;
  packs: Record<string, PolicyPackLockEntry>;
}

interface InstallRoot {
  scope: PolicyPackScope;
  root: string;
  policyDir: string;
  cacheDir: string;
  sourcesPath: string;
  lockPath: string;
}

interface DiscoveredPolicyPack {
  name: string;
  sourcePath: string;
}

interface InstalledPolicyPack {
  name: string;
  url: string;
  ref: string;
  source_path: string;
  installed_path: string;
  absolute_path: string;
  resolved_commit: string;
  sha256: string;
}

interface PreparedPolicyPack extends InstalledPolicyPack {
  content: string;
}

export async function installPolicyPacks(
  input: PolicyPackInstallInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  scope: PolicyPackScope;
  source_registry_path: string;
  lock_path: string;
  installed: InstalledPolicyPack[];
}> {
  const url = requiredNonEmpty(input.url, "url");
  const ref = normalizeRef(input.ref);
  assertSafeGitValue(url, "url");
  assertSafeGitValue(ref, "ref");
  const installRoot = resolveInstallRoot(input, env);
  const sourceKey = sourceCacheKey(input.name ?? nameFromUrl(url), url);
  const checkoutDir = await prepareGitCheckout({ installRoot, sourceKey, url, ref });
  const resolvedCommit = (await runGit(["rev-parse", "HEAD"], checkoutDir)).trim();
  const discovered = await selectPolicyPacks({
    checkoutDir,
    name: input.name,
    sourcePath: input.path,
  });

  const sources = await readSourceRegistry(installRoot.sourcesPath);
  const lock = await readLock(installRoot.lockPath);
  const prepared: PreparedPolicyPack[] = [];

  for (const pack of discovered) {
    prepared.push(await preparePolicyPackMaterialization({
      installRoot,
      checkoutDir,
      pack,
      url,
      ref,
      resolvedCommit,
      oldLock: lock.packs[pack.name],
      force: input.force === true,
    }));
  }

  for (const pack of prepared) {
    sources.packs[pack.name] = {
      type: "git",
      url,
      ref,
      source_path: pack.source_path,
      installed_path: pack.installed_path,
    };
    lock.packs[pack.name] = {
      type: "git",
      url,
      ref,
      source_path: pack.source_path,
      installed_path: pack.installed_path,
      resolved_commit: resolvedCommit,
      sha256: pack.sha256,
      installed_at: new Date().toISOString(),
    };
  }

  await commitPreparedPolicyPacks(prepared, async () => {
    await writeJsonAtomic(installRoot.sourcesPath, sources);
    await writeJsonAtomic(installRoot.lockPath, lock);
  });

  return {
    scope: installRoot.scope,
    source_registry_path: installRoot.sourcesPath,
    lock_path: installRoot.lockPath,
    installed: prepared.map(toInstalledPolicyPack),
  };
}

export async function updatePolicyPacks(
  input: PolicyPackUpdateInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  scope: PolicyPackScope;
  source_registry_path: string;
  lock_path: string;
  updated: InstalledPolicyPack[];
}> {
  const installRoot = resolveInstallRoot(input, env);
  const sources = await readSourceRegistry(installRoot.sourcesPath);
  const lock = await readLock(installRoot.lockPath);
  const selectedNames = input.names?.length
    ? input.names.map((name) => sanitizeName(name))
    : Object.keys(sources.packs).sort();
  if (selectedNames.length === 0) {
    return {
      scope: installRoot.scope,
      source_registry_path: installRoot.sourcesPath,
      lock_path: installRoot.lockPath,
      updated: [],
    };
  }

  const prepared: PreparedPolicyPack[] = [];
  for (const name of selectedNames) {
    const source = sources.packs[name];
    if (!source) {
      throw new Error(`No installed policy pack source named '${name}'`);
    }
    assertSafeGitValue(source.url, "url");
    assertSafeGitValue(source.ref, "ref");
    assertSourceMatchesLock(name, source, lock.packs[name]);

    const checkoutDir = await prepareGitCheckout({
      installRoot,
      sourceKey: sourceCacheKey(name, source.url),
      url: source.url,
      ref: source.ref,
    });
    const resolvedCommit = (await runGit(["rev-parse", "HEAD"], checkoutDir)).trim();
    const pack = await selectSinglePolicyPackByPath(checkoutDir, name, source.source_path);
    prepared.push(await preparePolicyPackMaterialization({
      installRoot,
      checkoutDir,
      pack,
      url: source.url,
      ref: source.ref,
      resolvedCommit,
      oldLock: lock.packs[name],
      force: input.force === true,
    }));
  }

  for (const pack of prepared) {
    lock.packs[pack.name] = {
      type: "git",
      url: pack.url,
      ref: pack.ref,
      source_path: pack.source_path,
      installed_path: pack.installed_path,
      resolved_commit: pack.resolved_commit,
      sha256: pack.sha256,
      installed_at: new Date().toISOString(),
    };
  }

  await commitPreparedPolicyPacks(prepared, async () => {
    await writeJsonAtomic(installRoot.lockPath, lock);
  });

  return {
    scope: installRoot.scope,
    source_registry_path: installRoot.sourcesPath,
    lock_path: installRoot.lockPath,
    updated: prepared.map(toInstalledPolicyPack),
  };
}

function resolveInstallRoot(
  input: { scope?: PolicyPackScope; root_dir?: string; home?: string },
  env: NodeJS.ProcessEnv,
): InstallRoot {
  const scope = input.scope ?? "global";
  const root =
    scope === "project"
      ? path.resolve(input.root_dir ?? process.cwd())
      : path.join(requiredNonEmpty(input.home ?? env.HOME, "home"), GLOBAL_GROUNDWORK_CONFIG_DIR);
  const policyDir =
    scope === "project" ? path.join(root, PROJECT_GROUNDWORK_CONFIG_DIR) : root;
  return {
    scope,
    root,
    policyDir,
    cacheDir: path.join(policyDir, ".cache", "policy-sources"),
    sourcesPath: path.join(policyDir, SOURCE_REGISTRY_FILE),
    lockPath: path.join(policyDir, LOCK_FILE),
  };
}

async function prepareGitCheckout(options: {
  installRoot: InstallRoot;
  sourceKey: string;
  url: string;
  ref: string;
}): Promise<string> {
  const checkoutDir = path.join(options.installRoot.cacheDir, options.sourceKey, "repo");
  await fs.mkdir(path.dirname(checkoutDir), { recursive: true });
  if (!(await isGitCheckout(checkoutDir))) {
    await fs.rm(checkoutDir, { recursive: true, force: true });
    await runGit(["clone", options.url, checkoutDir]);
  } else {
    const origin = (await runGit(["remote", "get-url", "origin"], checkoutDir)).trim();
    if (origin !== options.url) {
      await fs.rm(checkoutDir, { recursive: true, force: true });
      await runGit(["clone", options.url, checkoutDir]);
    }
  }

  if (options.ref !== DEFAULT_REF) {
    await runGit(["fetch", "--tags", "--prune", "origin", options.ref], checkoutDir);
    await runGit(["checkout", "--detach", "FETCH_HEAD"], checkoutDir);
  } else {
    await runGit(["fetch", "--tags", "--prune", "origin"], checkoutDir);
    await runGit(["remote", "set-head", "origin", "--auto"], checkoutDir);
    const defaultRef = (await runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], checkoutDir)).trim();
    await runGit(["checkout", "--detach", defaultRef], checkoutDir);
  }

  return checkoutDir;
}

async function selectPolicyPacks(options: {
  checkoutDir: string;
  name?: string;
  sourcePath?: string;
}): Promise<DiscoveredPolicyPack[]> {
  if (options.sourcePath) {
    const name = sanitizeName(options.name ?? packNameFromPath(options.sourcePath));
    return [await selectSinglePolicyPackByPath(options.checkoutDir, name, options.sourcePath)];
  }

  const discovered = await discoverRepositoryPolicyPacks(options.checkoutDir);
  if (options.name) {
    const name = sanitizeName(options.name);
    const found = discovered.find((pack) => pack.name === name);
    if (!found) {
      throw new Error(
        `Policy pack '${name}' was not found in .groundwork/policies. Available: ${discovered.map((pack) => pack.name).join(", ") || "(none)"}`,
      );
    }
    return [found];
  }

  if (discovered.length === 0) {
    throw new Error("No policy packs found under .groundwork/policies");
  }

  return discovered;
}

async function selectSinglePolicyPackByPath(
  checkoutDir: string,
  name: string,
  sourcePath: string,
): Promise<DiscoveredPolicyPack> {
  const resolved = resolveRepoRelativePath(checkoutDir, sourcePath);
  await assertRegularFile(resolved, `Policy pack source '${sourcePath}' was not found`);
  return { name, sourcePath: normalizeRepoPath(checkoutDir, resolved) };
}

async function discoverRepositoryPolicyPacks(checkoutDir: string): Promise<DiscoveredPolicyPack[]> {
  const policyDir = path.join(checkoutDir, PROJECT_GROUNDWORK_CONFIG_DIR, "policies");
  let entries: string[];
  try {
    entries = await fs.readdir(policyDir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }

  const packs: DiscoveredPolicyPack[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".toml")) continue;
    const fullPath = path.join(policyDir, entry);
    if (!(await isRegularNonSymlinkFile(fullPath))) continue;
    packs.push({
      name: sanitizeName(stripTomlExtension(entry).replace(/^\./, "")),
      sourcePath: normalizeRepoPath(checkoutDir, fullPath),
    });
  }
  return packs;
}

async function preparePolicyPackMaterialization(options: {
  installRoot: InstallRoot;
  checkoutDir: string;
  pack: DiscoveredPolicyPack;
  url: string;
  ref: string;
  resolvedCommit: string;
  oldLock?: PolicyPackLockEntry;
  force: boolean;
}): Promise<PreparedPolicyPack> {
  const sourceAbsolutePath = resolveRepoRelativePath(
    options.checkoutDir,
    options.pack.sourcePath,
  );
  const sourceText = await fs.readFile(sourceAbsolutePath, "utf8");
  validatePolicyPackToml(sourceText, options.pack.sourcePath);
  const sha256 = hashText(sourceText);
  const installedRelativePath = `plugins/${options.pack.name}.toml`;
  const installedPath = path.join(options.installRoot.policyDir, installedRelativePath);
  await assertOverwriteAllowed(installedPath, options.oldLock, options.force);
  return {
    name: options.pack.name,
    url: options.url,
    ref: options.ref,
    source_path: options.pack.sourcePath,
    installed_path: installedRelativePath,
    absolute_path: installedPath,
    resolved_commit: options.resolvedCommit,
    sha256,
    content: sourceText,
  };
}

function toInstalledPolicyPack(pack: PreparedPolicyPack): InstalledPolicyPack {
  const { content: _content, ...installed } = pack;
  return installed;
}

async function commitPreparedPolicyPacks(
  packs: PreparedPolicyPack[],
  writeMetadata: () => Promise<void>,
): Promise<void> {
  const backups = await Promise.all(
    packs.map(async (pack) => ({
      path: pack.absolute_path,
      previous: await readOptionalFile(pack.absolute_path),
    })),
  );

  try {
    for (const pack of packs) {
      await writeFileAtomic(pack.absolute_path, pack.content);
    }
    await writeMetadata();
  } catch (error) {
    await Promise.all(
      backups.map(async (backup) => {
        if (backup.previous === null) {
          await fs.rm(backup.path, { force: true });
          return;
        }
        await writeFileAtomic(backup.path, backup.previous);
      }),
    );
    throw error;
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function validatePolicyPackToml(sourceText: string, sourcePath: string): void {
  try {
    const config = parsePolicyConfig(parseToml(sourceText));
    if ((config.includes?.length ?? 0) > 0 || (config.plugins?.length ?? 0) > 0) {
      throw new Error("Git-installed policy packs cannot declare includes or plugins in v1");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Policy pack '${sourcePath}' is invalid: ${message}`);
  }
}

function assertSourceMatchesLock(
  name: string,
  source: PolicyPackSourceEntry,
  lock: PolicyPackLockEntry | undefined,
): void {
  if (!lock) {
    throw new Error(`No lock entry found for installed policy pack '${name}'. Reinstall the pack.`);
  }
  if (
    source.url !== lock.url ||
    source.ref !== lock.ref ||
    source.source_path !== lock.source_path ||
    source.installed_path !== lock.installed_path
  ) {
    throw new Error(
      `Policy pack source metadata for '${name}' differs from the lock. Reinstall the pack to change sources.`,
    );
  }
}

async function assertOverwriteAllowed(
  installedPath: string,
  oldLock: PolicyPackLockEntry | undefined,
  force: boolean,
): Promise<void> {
  if (force || !(await isRegularFile(installedPath))) return;
  if (!oldLock) {
    throw new Error(`Policy pack already exists at '${installedPath}'. Set force=true to overwrite.`);
  }

  const current = await fs.readFile(installedPath, "utf8");
  if (hashText(current) !== oldLock.sha256) {
    throw new Error(
      `Policy pack '${installedPath}' has local edits. Set force=true to overwrite.`,
    );
  }
}

async function readSourceRegistry(filePath: string): Promise<PolicyPackSourceRegistry> {
  const parsed = await readJsonFile(filePath);
  if (!isRecord(parsed) || parsed.schema_version !== SOURCE_SCHEMA_VERSION) {
    return { schema_version: SOURCE_SCHEMA_VERSION, packs: {} };
  }
  return {
    schema_version: SOURCE_SCHEMA_VERSION,
    packs: parseSourceEntries(parsed.packs),
  };
}

async function readLock(filePath: string): Promise<PolicyPackLock> {
  const parsed = await readJsonFile(filePath);
  if (!isRecord(parsed) || parsed.schema_version !== LOCK_SCHEMA_VERSION) {
    return { schema_version: LOCK_SCHEMA_VERSION, packs: {} };
  }
  return {
    schema_version: LOCK_SCHEMA_VERSION,
    packs: parseLockEntries(parsed.packs),
  };
}

function parseSourceEntries(value: unknown): Record<string, PolicyPackSourceEntry> {
  if (!isRecord(value)) return {};
  const entries: Record<string, PolicyPackSourceEntry> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry) || entry.type !== "git") continue;
    if (
      typeof entry.url !== "string" ||
      typeof entry.ref !== "string" ||
      typeof entry.source_path !== "string" ||
      typeof entry.installed_path !== "string"
    ) {
      continue;
    }
    entries[sanitizeName(name)] = {
      type: "git",
      url: entry.url,
      ref: entry.ref,
      source_path: entry.source_path,
      installed_path: entry.installed_path,
    };
  }
  return entries;
}

function parseLockEntries(value: unknown): Record<string, PolicyPackLockEntry> {
  if (!isRecord(value)) return {};
  const entries: Record<string, PolicyPackLockEntry> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry) || entry.type !== "git") continue;
    if (
      typeof entry.url !== "string" ||
      typeof entry.ref !== "string" ||
      typeof entry.source_path !== "string" ||
      typeof entry.installed_path !== "string" ||
      typeof entry.resolved_commit !== "string" ||
      typeof entry.sha256 !== "string" ||
      typeof entry.installed_at !== "string"
    ) {
      continue;
    }
    entries[sanitizeName(name)] = {
      type: "git",
      url: entry.url,
      ref: entry.ref,
      source_path: entry.source_path,
      installed_path: entry.installed_path,
      resolved_commit: entry.resolved_commit,
      sha256: entry.sha256,
      installed_at: entry.installed_at,
    };
  }
  return entries;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function isGitCheckout(directory: string): Promise<boolean> {
  return isRegularFile(path.join(directory, ".git", "HEAD"));
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function isRegularNonSymlinkFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function assertRegularFile(filePath: string, message: string): Promise<void> {
  if (!(await isRegularNonSymlinkFile(filePath))) {
    throw new Error(message);
  }
}

function resolveRepoRelativePath(repoDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Policy pack source path must be repo-relative: '${relativePath}'`);
  }
  const resolved = path.resolve(repoDir, relativePath);
  const relative = path.relative(repoDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Policy pack source path escapes the repository: '${relativePath}'`);
  }
  return resolved;
}

function normalizeRepoPath(repoDir: string, filePath: string): string {
  return path.relative(repoDir, filePath).split(path.sep).join("/");
}

function requiredNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Policy pack ${field} is required`);
  }
  return trimmed;
}

function normalizeRef(ref: string | undefined): string {
  return ref?.trim() || DEFAULT_REF;
}

function assertSafeGitValue(value: string, field: "url" | "ref"): void {
  if (value.startsWith("-") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Policy pack ${field} is not a safe Git argument`);
  }
}

function nameFromUrl(url: string): string {
  const base = url.replace(/\/+$/, "").split("/").at(-1) ?? "policy-pack";
  return stripTomlExtension(base.replace(/\.git$/, ""));
}

function packNameFromPath(sourcePath: string): string {
  return stripTomlExtension(path.basename(sourcePath)).replace(/^\./, "");
}

function stripTomlExtension(fileName: string): string {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}

function sanitizeName(name: string): string {
  const normalized = name.trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    throw new Error(`Invalid policy pack name '${name}'`);
  }
  return normalized;
}

function sourceCacheKey(name: string, url: string): string {
  const safeName = sanitizeName(name);
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `${safeName}-${digest}`;
}

function hashText(text: string): string {
  return `sha256-${createHash("sha256").update(text).digest("hex")}`;
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const result = await runProcess("git", args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

async function runProcess(
  command: string,
  args: string[],
  cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
