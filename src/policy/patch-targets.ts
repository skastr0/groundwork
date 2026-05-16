import { collapseLineNumbers } from "../kernel/line-ranges.ts";
import { mergeChangeTarget } from "./change-targets.ts";
import type { GuardrailChangeTarget } from "./config.ts";
import { normalizePathForMatching } from "./paths.ts";

const MAX_PATCH_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_PATCH_HEADER_PATHS = 4096;
const MAX_PATCH_PATH_LENGTH = 4096;

type PatchTargetState = {
  currentPath: string | null;
  addedLines: number[];
  deletedLines: number[];
  beforeLine: number | null;
  afterLine: number | null;
};

type PatchHeaderPath =
  | {
      kind: "none";
    }
  | {
      kind: "invalid";
      mode: PatchHeaderMode;
    }
  | {
      kind: "valid";
      mode: PatchHeaderMode;
      path: string;
    };

type PatchHeaderMode = "file" | "move";

export function extractPathsFromPatchText(patchText: string): string[] {
  assertPatchTextSize(patchText);

  const results: string[] = [];
  for (const rawLine of patchText.split(/\r?\n/)) {
    const header = readPatchHeaderPath(rawLine);
    if (header.kind !== "valid") {
      continue;
    }

    results.push(header.path);
    if (results.length > MAX_PATCH_HEADER_PATHS) {
      throw new Error(`Patch text references too many paths (${MAX_PATCH_HEADER_PATHS} max)`);
    }
  }

  return results;
}

export function extractTargetsFromPatchText(
  rootDir: string,
  patchText: string,
): GuardrailChangeTarget[] {
  assertPatchTextSize(patchText);

  const results = new Map<string, GuardrailChangeTarget>();
  const state = createPatchTargetState();

  for (const rawLine of patchText.split(/\r?\n/)) {
    const header = readPatchHeaderPath(rawLine);
    if (header.kind === "valid") {
      if (header.mode === "file") {
        flushCurrentPatchTarget(rootDir, state, results);
      }
      state.currentPath = header.path;
      continue;
    }

    if (header.kind === "invalid") {
      if (header.mode === "file") {
        flushCurrentPatchTarget(rootDir, state, results);
      } else {
        resetPatchTargetState(state);
      }
      continue;
    }

    if (startPatchHunk(rawLine, state)) {
      continue;
    }

    advancePatchHunkLine(rawLine, state);
  }

  flushCurrentPatchTarget(rootDir, state, results);
  return Array.from(results.values());
}

function assertPatchTextSize(patchText: string): void {
  if (patchText.length > MAX_PATCH_TEXT_BYTES) {
    throw new Error(`Patch text exceeds safe inspection size (${MAX_PATCH_TEXT_BYTES} bytes)`);
  }
}

function createPatchTargetState(): PatchTargetState {
  return {
    currentPath: null,
    addedLines: [],
    deletedLines: [],
    beforeLine: null,
    afterLine: null,
  };
}

function readPatchHeaderPath(rawLine: string): PatchHeaderPath {
  const line = rawLine.trim();
  const fileMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
  if (fileMatch?.[1]) {
    return readPatchHeaderValue("file", fileMatch[1]);
  }

  const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
  if (moveMatch?.[1]) {
    return readPatchHeaderValue("move", moveMatch[1]);
  }

  return { kind: "none" };
}

function readPatchHeaderValue(mode: PatchHeaderMode, patchPath: string): PatchHeaderPath {
  const trimmed = patchPath.trim();
  if (!isSafePatchPath(trimmed)) {
    return { kind: "invalid", mode };
  }

  return { kind: "valid", mode, path: trimmed };
}

function flushCurrentPatchTarget(
  rootDir: string,
  state: PatchTargetState,
  results: Map<string, GuardrailChangeTarget>,
): void {
  if (state.currentPath) {
    mergeChangeTarget(results, {
      normalizedPath: normalizePathForMatching(rootDir, state.currentPath),
      changedLineRanges: collapseLineNumbers(state.addedLines),
      deletedLineRanges: collapseLineNumbers(state.deletedLines),
    });
  }

  resetPatchTargetState(state);
}

function resetPatchTargetState(state: PatchTargetState): void {
  state.currentPath = null;
  state.addedLines = [];
  state.deletedLines = [];
  state.beforeLine = null;
  state.afterLine = null;
}

function startPatchHunk(rawLine: string, state: PatchTargetState): boolean {
  const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!hunkMatch?.[1] || !hunkMatch[2] || !state.currentPath) {
    return false;
  }

  state.beforeLine = Number(hunkMatch[1]);
  state.afterLine = Number(hunkMatch[2]);
  return true;
}

function advancePatchHunkLine(rawLine: string, state: PatchTargetState): void {
  if (state.beforeLine === null || state.afterLine === null) {
    return;
  }

  if (rawLine.startsWith("+")) {
    state.addedLines.push(state.afterLine);
    state.afterLine += 1;
    return;
  }

  if (rawLine.startsWith("-")) {
    state.deletedLines.push(state.beforeLine);
    state.beforeLine += 1;
    return;
  }

  if (rawLine.startsWith(" ")) {
    state.beforeLine += 1;
    state.afterLine += 1;
    return;
  }

  if (!rawLine.startsWith("\\")) {
    state.beforeLine = null;
    state.afterLine = null;
  }
}

function isSafePatchPath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PATCH_PATH_LENGTH) {
    return false;
  }

  return !/[\r\n]/.test(value) && !value.includes("\0");
}
