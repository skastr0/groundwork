import path from "node:path";
import type {
  FrameworkIgnoredToolTarget,
  FrameworkIgnoredToolTargetReason,
  FrameworkToolTarget,
  FrameworkToolTargetExtraction,
  FrameworkToolTargetPatchAction,
  FrameworkToolTargetSource,
} from "./state.ts";

type ToolArgs = Record<string, unknown>;

type ParsedPatchTarget = {
  beforePath?: string;
  afterPath?: string;
  action: FrameworkToolTargetPatchAction;
};

type NormalizedToolPath =
  | {
      ok: true;
      rawPath: string;
      normalizedPath: string;
    }
  | {
      ok: false;
      rawPath: string;
      reason: FrameworkIgnoredToolTargetReason;
    };

const PATH_KEYS = new Set(["filepath", "path"]);
const PATCH_KEYS = new Set(["patchtext", "patch"]);
const MAX_PATCH_PATH_LENGTH = 4096;

function isToolArgs(value: unknown): value is ToolArgs {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toLocation(parent: string, segment: string | number): string {
  if (typeof segment === "number") {
    return `${parent}[${segment}]`;
  }

  return parent ? `${parent}.${segment}` : segment;
}

function normalizeSourceKey(key: string): string {
  return key.toLowerCase();
}

function normalizeSlashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeToolPath(
  rawPath: string,
  directory: string,
  rootDir: string,
  options: { patch: boolean },
): NormalizedToolPath {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { ok: false, rawPath: trimmed, reason: "empty-path" };
  }

  if (
    /[\r\n]/.test(trimmed) ||
    trimmed.includes("\0") ||
    (options.patch && trimmed.length > MAX_PATCH_PATH_LENGTH)
  ) {
    return { ok: false, rawPath: trimmed, reason: "unsafe-path" };
  }

  const absolutePath = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(directory, trimmed);
  const relativePath = path.relative(rootDir, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return { ok: false, rawPath: trimmed, reason: "outside-root" };
  }

  return {
    ok: true,
    rawPath: trimmed,
    normalizedPath: normalizeSlashPath(relativePath || "."),
  };
}

function parsePatchTargets(patchText: string): ParsedPatchTarget[] {
  const targets: ParsedPatchTarget[] = [];
  const lines = patchText.split(/\r?\n/);
  let current: ParsedPatchTarget | null = null;

  const flush = () => {
    if (!current) return;
    if (current.beforePath || current.afterPath) {
      targets.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("*** Add File: ")) {
      flush();
      current = {
        afterPath: line.slice("*** Add File: ".length).trim(),
        action: "add",
      };
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      flush();
      const filePath = line.slice("*** Update File: ".length).trim();
      current = {
        beforePath: filePath,
        afterPath: filePath,
        action: "update",
      };
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      flush();
      current = {
        beforePath: line.slice("*** Delete File: ".length).trim(),
        action: "delete",
      };
      continue;
    }

    if (line.startsWith("*** Move to: ")) {
      const movePath = line.slice("*** Move to: ".length).trim();
      if (!current) {
        current = { afterPath: movePath, action: "move" };
      } else {
        current.afterPath = movePath;
        current.action = "move";
      }
    }
  }

  flush();
  return targets;
}

function buildArgumentSource(key: string, location: string): FrameworkToolTargetSource {
  return {
    kind: "argument",
    key,
    location,
  };
}

function buildPatchSource(
  key: string,
  location: string,
  action: FrameworkToolTargetPatchAction,
): FrameworkToolTargetSource {
  return {
    kind: "patch",
    key,
    location,
    patchAction: action,
  };
}

function buildIgnoredTarget(
  pathValue: string,
  reason: FrameworkIgnoredToolTargetReason,
  source: FrameworkToolTargetSource,
  paths?: { beforePath?: string; afterPath?: string },
): FrameworkIgnoredToolTarget {
  return {
    path: pathValue,
    reason,
    source,
    beforePath: paths?.beforePath,
    afterPath: paths?.afterPath,
  };
}

function buildArgumentTarget(
  resolvedPath: Extract<NormalizedToolPath, { ok: true }>,
  source: FrameworkToolTargetSource,
): FrameworkToolTarget {
  return {
    path: resolvedPath.rawPath,
    normalizedPath: resolvedPath.normalizedPath,
    beforePath: resolvedPath.normalizedPath,
    afterPath: resolvedPath.normalizedPath,
    source,
  };
}

function buildPatchTarget(
  source: FrameworkToolTargetSource,
  beforePath: Extract<NormalizedToolPath, { ok: true }> | undefined,
  afterPath: Extract<NormalizedToolPath, { ok: true }> | undefined,
): FrameworkToolTarget {
  const recordPath = afterPath?.rawPath ?? beforePath?.rawPath ?? "";
  const normalizedPath = afterPath?.normalizedPath ?? beforePath?.normalizedPath;

  return {
    path: recordPath,
    normalizedPath,
    beforePath: beforePath?.normalizedPath,
    afterPath: afterPath?.normalizedPath,
    source,
  };
}

export function extractFrameworkToolTargets(
  args: ToolArgs | undefined,
  options: {
    toolName: string;
    directory: string;
    rootDir: string;
  },
): FrameworkToolTargetExtraction {
  const result: FrameworkToolTargetExtraction = {
    toolName: options.toolName,
    targets: [],
    ignoredTargets: [],
  };

  const pushArgumentPath = (rawPath: string, key: string, location: string) => {
    const source = buildArgumentSource(key, location);
    const resolvedPath = normalizeToolPath(rawPath, options.directory, options.rootDir, {
      patch: false,
    });
    if (!resolvedPath.ok) {
      result.ignoredTargets.push(
        buildIgnoredTarget(resolvedPath.rawPath, resolvedPath.reason, source),
      );
      return;
    }

    result.targets.push(buildArgumentTarget(resolvedPath, source));
  };

  const pushPatchText = (patchText: string, key: string, location: string) => {
    const patchTargets = parsePatchTargets(patchText);
    patchTargets.forEach((target, index) => {
      const source = buildPatchSource(key, `${location}#${index}`, target.action);
      const normalizedBeforePath = target.beforePath
        ? normalizeToolPath(target.beforePath, options.directory, options.rootDir, { patch: true })
        : undefined;
      const normalizedAfterPath = target.afterPath
        ? normalizeToolPath(target.afterPath, options.directory, options.rootDir, { patch: true })
        : undefined;

      const rejectedPath = [normalizedBeforePath, normalizedAfterPath].find(
        (candidate): candidate is Extract<NormalizedToolPath, { ok: false }> =>
          !!candidate && !candidate.ok,
      );
      if (rejectedPath) {
        result.ignoredTargets.push(
          buildIgnoredTarget(rejectedPath.rawPath, rejectedPath.reason, source, {
            beforePath: target.beforePath?.trim(),
            afterPath: target.afterPath?.trim(),
          }),
        );
        return;
      }

      const beforePath = normalizedBeforePath?.ok ? normalizedBeforePath : undefined;
      const afterPath = normalizedAfterPath?.ok ? normalizedAfterPath : undefined;
      result.targets.push(buildPatchTarget(source, beforePath, afterPath));
    });
  };

  const visit = (value: unknown, location: string, key?: string) => {
    if (typeof value === "string" && key) {
      const normalizedKey = normalizeSourceKey(key);
      if (PATCH_KEYS.has(normalizedKey)) {
        pushPatchText(value, key, location);
      } else if (PATH_KEYS.has(normalizedKey)) {
        pushArgumentPath(value, key, location);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, toLocation(location, index), key);
      });
      return;
    }

    if (!isToolArgs(value)) {
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, toLocation(location, childKey), childKey);
    }
  };

  if (args) {
    visit(args, "");
  }

  return result;
}
