import path from "node:path";
import { extractFrameworkToolTargets, type FrameworkToolTarget } from "../kernel/index.ts";
import { updateSessionArtifactState } from "../session/index.ts";
import {
  discoverFrameworkContextFiles,
  type FrameworkDiscoveredContextFile,
} from "./discovery.ts";

const SERVICE = "groundwork-context";
const ACTION = "context-reminder";
const MAX_REMINDERS = 4;
const MAX_BYTES = 3072;

export interface ContextTouchedPathsInput {
  root_dir?: string;
  directory?: string;
  session_id: string;
  tool?: string;
  args?: Record<string, unknown>;
  targets?: Record<string, unknown>[];
}

export async function evaluateContextTouchedPaths(input: ContextTouchedPathsInput) {
  const rootDir = path.resolve(input.root_dir ?? input.directory ?? process.cwd());
  const directory = path.resolve(input.directory ?? rootDir);
  const frameworkTargets =
    input.targets && input.targets.length > 0
      ? normalizeExplicitTargets(input.targets, { directory, rootDir })
      : extractFrameworkToolTargets(input.args, {
          toolName: input.tool ?? "unknown",
          directory,
          rootDir,
        }).targets;

  const discovered = await collectDiscoveredContextFiles(frameworkTargets, { directory, rootDir });
  const updated = await updateSessionArtifactState(rootDir, input.session_id, (state) => {
    const now = new Date().toISOString();
    const newFiles: FrameworkDiscoveredContextFile[] = [];
    const repeatedFiles: FrameworkDiscoveredContextFile[] = [];

    for (const file of discovered) {
      const key = createContextActionKey(file.path);
      if (state.actions[key]) {
        repeatedFiles.push(file);
        state.actions[key].lastSeenAt = now;
        state.actions[key].count += 1;
        continue;
      }

      newFiles.push(file);
      state.actions[key] = {
        source: SERVICE,
        action: ACTION,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
        metadata: {
          path: file.path,
          fileName: file.fileName,
        },
      };
    }

    const reminders = buildReminderText(newFiles);
    return {
      newFiles,
      repeatedFiles,
      reminders,
    };
  });

  return {
    command: "context touched-paths",
    session_id: input.session_id,
    discovered: discovered.map(toContextFileSummary),
    new_files: updated.result.newFiles.map(toContextFileSummary),
    repeated_files: updated.result.repeatedFiles.map(toContextFileSummary),
    reminders: updated.result.reminders,
  };
}

async function collectDiscoveredContextFiles(
  targets: readonly FrameworkToolTarget[],
  options: { directory: string; rootDir: string },
): Promise<FrameworkDiscoveredContextFile[]> {
  const files: FrameworkDiscoveredContextFile[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const targetPath = target.afterPath ?? target.beforePath ?? target.normalizedPath;
    if (!targetPath || targetPath === ".") continue;
    const discovered = await discoverFrameworkContextFiles({
      targetPath: path.join(options.rootDir, targetPath),
      directory: options.directory,
      rootDir: options.rootDir,
    });
    for (const file of discovered) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }
  }
  return files;
}

function buildReminderText(files: readonly FrameworkDiscoveredContextFile[]): string[] {
  const reminders: string[] = [];
  let usedBytes = 0;
  for (const file of files.slice(0, MAX_REMINDERS)) {
    const text = `Instructions from: ${file.path}\n${file.content}`.trim();
    const available = MAX_BYTES - usedBytes;
    if (available <= 0) break;
    const bounded = truncateByBytes(text, available);
    if (!bounded) continue;
    reminders.push(bounded);
    usedBytes += Buffer.byteLength(bounded, "utf8");
  }
  return reminders;
}

function truncateByBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  for (const char of text) {
    const next = `${out}${char}`;
    if (Buffer.byteLength(next, "utf8") > maxBytes) break;
    out = next;
  }
  return out;
}

function createContextActionKey(contextPath: string): string {
  return `${SERVICE}:${ACTION}:${contextPath}`;
}

function normalizeExplicitTargets(
  targets: readonly Record<string, unknown>[],
  options: { directory: string; rootDir: string },
): FrameworkToolTarget[] {
  return targets
    .map((target) => normalizeInputTarget(target, options))
    .filter((target): target is FrameworkToolTarget => target !== null);
}

function normalizeInputTarget(
  target: Record<string, unknown>,
  options: { directory: string; rootDir: string },
): FrameworkToolTarget | null {
  const rawPath = readTargetPath(target);
  if (!rawPath) return null;
  const normalizedPath = normalizeTouchedPath(rawPath, options);
  if (!normalizedPath) return null;
  const beforePath = readOptionalNormalizedTargetPath(target.beforePath, options);
  const afterPath = readOptionalNormalizedTargetPath(target.afterPath, options);
  return {
    path: rawPath,
    normalizedPath,
    beforePath,
    afterPath,
  };
}

function readTargetPath(target: Record<string, unknown>): string | null {
  for (const key of ["normalizedPath", "path", "afterPath", "beforePath"]) {
    const value = target[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function readOptionalNormalizedTargetPath(
  value: unknown,
  options: { directory: string; rootDir: string },
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return normalizeTouchedPath(value, options) ?? undefined;
}

function normalizeTouchedPath(
  rawPath: string,
  options: { directory: string; rootDir: string },
): string | null {
  const trimmed = rawPath.trim();
  if (/[\r\n]/.test(trimmed) || trimmed.includes("\0")) return null;
  const absolute = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(options.directory, trimmed);
  const relative = path.relative(options.rootDir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return normalizeSlashPath(relative || ".");
}

function normalizeSlashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function toContextFileSummary(file: FrameworkDiscoveredContextFile) {
  return {
    path: file.path,
    file_name: file.fileName,
  };
}
