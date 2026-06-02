import path from "node:path";
import { Effect } from "effect";
import { readFileResultEffect } from "../../../shared/effect-runtime.ts";
import { normalizeRequestedPath } from "../state/internal.ts";
import { toNormalizedPath } from "./shared.ts";

export type DiffAnchorResolution = {
  kind: "file" | "diff";
  requestedPath: string;
  resolvedPath: string;
  diffText?: string;
};

async function safeReadFile(filePath: string): Promise<string | null> {
  const result = await Effect.runPromise(readFileResultEffect(filePath));
  if (result.status === "available") {
    return result.content;
  }

  if (result.status === "missing") {
    return null;
  }

  throw result.error;
}

function looksLikeDiffArtifact(filePath: string, content: string | null): boolean {
  const normalized = toNormalizedPath(filePath);
  if (normalized.endsWith(".diff") || normalized.endsWith(".patch")) {
    return true;
  }

  return (content?.trimStart() ?? "").startsWith("diff --git ");
}

export async function resolveDiffAnchor(options: {
  rootDir: string;
  requestedPath: string;
}): Promise<DiffAnchorResolution> {
  const resolvedPath = normalizeRequestedPath(options.requestedPath, options.rootDir);
  const absolutePath = path.isAbsolute(resolvedPath)
    ? resolvedPath
    : path.join(options.rootDir, resolvedPath);
  const content = await safeReadFile(absolutePath);

  if (looksLikeDiffArtifact(resolvedPath, content)) {
    if (content === null) {
      throw new Error(`Diff anchor '${resolvedPath}' does not exist.`);
    }

    return {
      kind: "diff",
      requestedPath: options.requestedPath,
      resolvedPath,
      diffText: content,
    };
  }

  return {
    kind: "file",
    requestedPath: options.requestedPath,
    resolvedPath,
  };
}
