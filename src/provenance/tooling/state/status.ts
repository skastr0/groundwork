import { runProcessText, type ProcessCommand } from "../../../../shared/effect-runtime.ts";
import {
  type LocalFileComparisonStatus,
  type LocalRepoFileStatus,
  type LocalRepoFileStatusKind,
  type Shell,
} from "./types.ts";
import { readTextOrEmpty } from "./git-helpers.ts";

export type LocalStatusSnapshot = {
  indexFiles: LocalRepoFileStatus[];
  worktreeFiles: LocalRepoFileStatus[];
};

export type LocalDiffEntry = {
  status: Exclude<LocalFileComparisonStatus, "unchanged">;
  path: string;
  newPath?: string;
};

const STATUS_PRIORITY: Record<LocalRepoFileStatusKind, number> = {
  unknown: 0,
  modified: 1,
  added: 2,
  deleted: 3,
  copied: 4,
  renamed: 5,
};

const FILE_COMPARISON_STATUS_BY_CODE: Record<
  string,
  Exclude<LocalFileComparisonStatus, "unchanged">
> = {
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type_changed",
};

function normalizeStatus(code: string, fallbackPath: string): LocalRepoFileStatus {
  const trimmed = fallbackPath.trim();

  if (code.includes("R") || trimmed.includes(" -> ")) {
    const [from, to] = trimmed.split(" -> ");
    if (from && to) {
      return {
        status: "renamed",
        path: from,
        newPath: to,
      };
    }

    return {
      status: "renamed",
      path: trimmed,
    };
  }

  if (code.includes("C")) {
    return {
      status: "copied",
      path: trimmed,
    };
  }

  if (code.includes("D")) {
    return {
      status: "deleted",
      path: trimmed,
    };
  }

  if (code.includes("A")) {
    return {
      status: "added",
      path: trimmed,
    };
  }

  if (code.includes("M")) {
    return {
      status: "modified",
      path: trimmed,
    };
  }

  return {
    status: "unknown",
    path: trimmed,
  };
}

function mergeFileStatuses(files: LocalRepoFileStatus[]): LocalRepoFileStatus[] {
  const merged = new Map<string, LocalRepoFileStatus>();

  for (const file of files) {
    const key = file.newPath ?? file.path;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, file);
      continue;
    }

    if (STATUS_PRIORITY[file.status] >= STATUS_PRIORITY[existing.status]) {
      merged.set(key, file);
    }
  }

  return [...merged.values()].sort((left, right) => {
    const leftPath = left.newPath ?? left.path;
    const rightPath = right.newPath ?? right.path;
    return leftPath.localeCompare(rightPath);
  });
}

export function parseLocalStatusSnapshot(raw: string): LocalStatusSnapshot {
  const indexFiles: LocalRepoFileStatus[] = [];
  const worktreeFiles: LocalRepoFileStatus[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim() || line.startsWith("!!")) continue;

    const xy = line.slice(0, 2);
    const pathPart = line.length >= 3 ? line.slice(3) : "";
    if (!pathPart.trim() || xy === "??") continue;

    const stagedCode = xy.charAt(0);
    const unstagedCode = xy.charAt(1);

    if (stagedCode && stagedCode !== " ") {
      indexFiles.push(normalizeStatus(stagedCode, pathPart));
    }

    if (unstagedCode && unstagedCode !== " ") {
      worktreeFiles.push(normalizeStatus(unstagedCode, pathPart));
    }
  }

  return {
    indexFiles: mergeFileStatuses(indexFiles),
    worktreeFiles: mergeFileStatuses(worktreeFiles),
  };
}

function normalizeFileComparisonStatus(
  code: string,
): Exclude<LocalFileComparisonStatus, "unchanged"> {
  const normalized = code.trim().charAt(0);
  return FILE_COMPARISON_STATUS_BY_CODE[normalized] ?? "unknown";
}

export function parseNameStatusEntries(raw: string): LocalDiffEntry[] {
  const entries: LocalDiffEntry[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split("\t").filter((part) => part.length > 0);
    if (parts.length < 2) continue;

    const statusCode = parts[0] ?? "";
    const path = parts[1]?.trim();
    if (!path) continue;

    const status = normalizeFileComparisonStatus(statusCode);
    if ((status === "renamed" || status === "copied") && parts[2]?.trim()) {
      entries.push({
        status,
        path,
        newPath: parts[2]?.trim(),
      });
      continue;
    }

    entries.push({
      status,
      path,
    });
  }

  return entries;
}

export async function getStatusSnapshot(shell: Shell): Promise<LocalStatusSnapshot> {
  const raw = await runProcessText({
    shell,
    cmd: ["git", "status", "--porcelain"],
    trim: false,
  });
  return parseLocalStatusSnapshot(raw);
}

export async function readNameStatusEntries(
  shell: Shell,
  cmd: ProcessCommand,
): Promise<LocalDiffEntry[]> {
  const raw = await readTextOrEmpty(shell, cmd, { trim: false });
  return parseNameStatusEntries(raw);
}
