import path from "node:path";
import { Effect } from "effect";
import { readFileStringEffect, runProcessText } from "../../../../shared/effect-runtime.ts";
import {
  DEFAULT_PROVENANCE_BYTE_LIMIT,
  resolveBoundedNumber,
  type ProvenanceContentLayer,
} from "../args.ts";
import type {
  ProvenanceBounds,
  ProvenanceEvidenceSource,
  ProvenanceWarning,
} from "../contracts.ts";
import type {
  CreateStateToolsOptions,
  LocalFileLayerState,
  LocalFileState,
} from "../state/index.ts";
import type { ProvReadData } from "./schemas.ts";

export function getSelectedLayerState(
  state: LocalFileState,
  layer: ProvenanceContentLayer,
): LocalFileLayerState {
  switch (layer) {
    case "base":
      return state.base;
    case "head":
      return state.head;
    case "index":
      return state.index;
    case "worktree":
      return state.worktree;
  }
}

export function applyTextBudget(
  value: string,
  requestedBytes: number | undefined,
): {
  text: string;
  bounds: ProvenanceBounds;
  byteCount: number;
} {
  const limit = resolveBoundedNumber(requestedBytes, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const byteCount = Buffer.byteLength(value, "utf8");

  if (byteCount <= limit) {
    return {
      text: value,
      bounds: {
        requested: requestedBytes,
        limit,
        returned: byteCount,
        truncated: false,
      },
      byteCount,
    };
  }

  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > limit) {
    end -= 1;
  }

  const text = value.slice(0, end);
  return {
    text,
    bounds: {
      requested: requestedBytes,
      limit,
      returned: Buffer.byteLength(text, "utf8"),
      truncated: true,
    },
    byteCount,
  };
}

export async function readSelectedLayerText(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  layer: ProvenanceContentLayer;
  selectedLayer: LocalFileLayerState;
}): Promise<string> {
  const { layer, selectedLayer } = options;

  if (!selectedLayer.exists) {
    return "";
  }

  switch (layer) {
    case "base":
    case "head":
      return runProcessText({
        shell: options.shell,
        cmd: ["git", "show", `${selectedLayer.ref}:${selectedLayer.path}`],
        trim: false,
      });
    case "index":
      return runProcessText({
        shell: options.shell,
        cmd: ["git", "show", `:${selectedLayer.path}`],
        trim: false,
      });
    case "worktree": {
      const filePath = resolveWorktreePath(options.rootDir, selectedLayer.path);
      return Effect.runPromise(readFileStringEffect(filePath));
    }
  }
}

export function buildContentHints(options: {
  layer: ProvenanceContentLayer;
  selectedLayer: LocalFileLayerState;
  bounds: ProvenanceBounds;
  byteCount: number;
}): string[] {
  const hints: string[] = [];

  if (!options.selectedLayer.exists) {
    hints.push(`Selected ${options.layer} layer is absent for '${options.selectedLayer.path}'.`);
  }

  if (options.bounds.truncated) {
    hints.push(
      `Content truncated to ${options.bounds.returned}/${options.byteCount} byte(s); rerun with a larger max_bytes to inspect more.`,
    );
  }

  return hints;
}

export function normalizeTextLines(value: string): string[] {
  if (!value) {
    return [];
  }

  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.endsWith("\n")) {
    const trimmed = normalized.slice(0, -1);
    return trimmed ? trimmed.split("\n") : [];
  }

  return normalized.split("\n");
}

export function createContentWarning(content: ProvReadData["content"]): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [];

  if (!content.exists) {
    warnings.push({
      code: "CONTENT_LAYER_ABSENT",
      message: `Selected ${content.layer} layer is absent for '${content.path}'.`,
      ambiguity: "low",
    });
  }

  if (content.bounds.truncated) {
    warnings.push({
      code: "CONTENT_TRUNCATED",
      message: `Selected layer content was truncated to ${content.bounds.returned} byte(s).`,
      ambiguity: "low",
    });
  }

  return warnings;
}

export function buildContentSource(content: ProvReadData["content"]): ProvenanceEvidenceSource {
  return {
    kind: "git",
    id: `content:${content.layer}`,
    ref: content.ref ?? content.layer,
    path: content.path,
    label: `${content.layer} content`,
    detail: content.exists
      ? `${content.bounds.returned} byte(s)${content.bounds.truncated ? " (truncated)" : ""}`
      : "absent",
  };
}

function resolveWorktreePath(rootDir: string, filePath: string): string {
  const absolutePath = path.resolve(rootDir, filePath);
  const relativeToRoot = path.relative(rootDir, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Path '${filePath}' resolved outside worktree '${rootDir}'.`);
  }

  return absolutePath;
}
