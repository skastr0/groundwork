import path from "node:path";
import {
  pathExists as checkPathExists,
  statPath,
} from "../../../shared/effect-runtime.ts";
import type { TreeAreaKind } from "./schemas.ts";
import {
  toErrorMessage,
  toNormalizedPath,
} from "./shared.ts";
import type { ResolvedTreeAnchor } from "./tree-types.ts";

function normalizeAnchorPath(requestedPath: string, rootDir: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new Error("Path must not be empty.");
  }

  if (trimmed === "." || trimmed === "./") {
    return ".";
  }

  if (!path.isAbsolute(trimmed)) {
    const normalized = toNormalizedPath(path.normalize(trimmed));
    return normalized.length > 0 && normalized !== "." ? normalized : ".";
  }

  const relative = path.relative(rootDir, trimmed);
  if (!relative) {
    return ".";
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path '${trimmed}' is outside worktree '${rootDir}'.`);
  }

  return toNormalizedPath(relative);
}

function resolveAnchorAbsolutePath(rootDir: string, resolvedPath: string): string {
  return resolvedPath === "." ? rootDir : path.join(rootDir, resolvedPath);
}

export async function detectAreaKind(
  rootDir: string,
  relativePath: string,
): Promise<TreeAreaKind> {
  if (relativePath === ".") {
    return "root";
  }

  const packageJsonPath = path.join(
    resolveAnchorAbsolutePath(rootDir, relativePath),
    "package.json",
  );
  return (await checkPathExists(packageJsonPath)) ? "package" : "directory";
}

export async function resolveTreeAnchor(options: {
  rootDir: string;
  requestedPath: string;
}): Promise<ResolvedTreeAnchor> {
  const requestedPath = options.requestedPath.trim();
  const normalizedPath = normalizeAnchorPath(requestedPath, options.rootDir);
  const absolutePath = resolveAnchorAbsolutePath(options.rootDir, normalizedPath);

  let stats: Awaited<ReturnType<typeof statPath>>;
  try {
    stats = await statPath(absolutePath);
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(`Tree anchor '${requestedPath}' is unavailable: ${message}`);
  }

  if (stats.isDirectory()) {
    return {
      requestedPath,
      resolvedPath: normalizedPath,
      kind: await detectAreaKind(options.rootDir, normalizedPath),
      warnings: [],
    };
  }

  if (!stats.isFile()) {
    throw new Error(`Tree anchor '${requestedPath}' must resolve to a directory or file.`);
  }

  const parentPath = path.dirname(normalizedPath);
  const resolvedPath = parentPath === "." ? "." : toNormalizedPath(parentPath);

  return {
    requestedPath,
    resolvedPath,
    kind: await detectAreaKind(options.rootDir, resolvedPath),
    warnings: [
      {
        code: "TREE_ANCHOR_FILE_RESOLVED_TO_PARENT",
        message: `Tree anchor '${requestedPath}' resolved to parent directory '${resolvedPath}'.`,
        ambiguity: "low",
      },
    ],
  };
}

export function isPathWithinAnchor(targetPath: string, anchorPath: string): boolean {
  const normalizedPath = toNormalizedPath(targetPath);
  if (!normalizedPath) {
    return false;
  }

  if (anchorPath === ".") {
    return true;
  }

  return normalizedPath === anchorPath || normalizedPath.startsWith(`${anchorPath}/`);
}
