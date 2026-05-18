import { runProcessText } from "../../../../shared/effect-runtime.ts";
import { resolveBoundedNumber } from "../args.ts";
import { normalizeRequestedPath, type CreateStateToolsOptions } from "../state/index.ts";
import {
  DAY_MS,
  DEFAULT_AUTHORITY_WINDOW_DAYS,
  HISTORY_COMMIT_LIMIT_OPTIONS,
  HISTORY_DETECTION_METHOD,
  HISTORY_HEAD_ANCHOR_METHOD,
  historyParseMaxOutputBytes,
} from "./constants.ts";
import type { HistoryCommit, HistoryHeadAnchor, HistoryLoadOptions, LoadedHistory, RawHistoryData } from "./types.ts";
import type { HistorySummary } from "./schemas.ts";

type HistoryChange = HistoryCommit["changes"][number];

function parseTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeAnalysisPath(requestedPath: string | undefined, rootDir?: string): string {
  const normalized = normalizeRequestedPath(requestedPath?.trim() || ".", rootDir);
  return normalized || ".";
}

export function normalizeWindowDays(
  requested: number[] | undefined,
  fallback: readonly number[],
): number[] {
  const values = requested && requested.length > 0 ? requested : [...fallback];
  return [...new Set(values.map((value) => Math.trunc(value)).filter((value) => value > 0))].sort(
    (left, right) => left - right,
  );
}

function normalizeHistoryPath(rawPath: string): string {
  const normalized = rawPath.trim().replace(/\\/g, "/");
  const bracePattern = /^(.*)\{(.+?) => (.+?)\}(.*)$/;
  const braceMatch = normalized.match(bracePattern);
  if (braceMatch) {
    return `${braceMatch[1]}${braceMatch[3]}${braceMatch[4]}`.replace(/\/+/g, "/");
  }

  if (normalized.includes(" => ")) {
    return normalized.split(" => ").at(-1)?.trim() ?? normalized;
  }

  return normalized;
}

function parseCommitHeader(line: string): HistoryCommit | null | undefined {
  const commitParts = line.split("\u001f");
  if (commitParts.length < 5) {
    return undefined;
  }

  const [commit, authoredAt, authorName, authorEmail, ...summaryParts] = commitParts;
  const authoredAtMs = parseTimestamp(authoredAt);
  if (!commit || !authoredAt || !authorName || !authorEmail || authoredAtMs === null) {
    return null;
  }

  return {
    commit,
    authoredAt,
    authoredAtMs,
    authorName,
    authorEmail,
    summary: summaryParts.join("\u001f") || "(no summary)",
    changes: [],
  };
}

function parseHistoryChange(line: string): HistoryChange | null {
  const [additionsRaw, deletionsRaw, ...pathParts] = line.split("\t");
  if (!additionsRaw || !deletionsRaw || pathParts.length === 0) {
    return null;
  }

  const additions = additionsRaw === "-" ? 0 : Number.parseInt(additionsRaw, 10) || 0;
  const deletions = deletionsRaw === "-" ? 0 : Number.parseInt(deletionsRaw, 10) || 0;
  const normalizedPath = normalizeHistoryPath(pathParts.join("\t"));
  return {
    path: normalizedPath,
    additions,
    deletions,
    churn: additions + deletions,
  };
}

export function parseHistoryLog(raw: string): HistoryCommit[] {
  const commits: HistoryCommit[] = [];
  let current: HistoryCommit | null = null;

  const pushCurrent = () => {
    if (current) {
      commits.push(current);
      current = null;
    }
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const commitHeader = parseCommitHeader(trimmed);
    if (commitHeader !== undefined) {
      pushCurrent();
      current = commitHeader;
      continue;
    }

    if (!current) {
      continue;
    }

    const change = parseHistoryChange(line);
    if (!change) {
      continue;
    }

    current.changes.push(change);
  }

  pushCurrent();
  return commits;
}

export async function loadHistory(options: {
  shell: CreateStateToolsOptions["shell"];
  resolvedPath: string;
  windowDays: number[];
  maxCommits: number | undefined;
}): Promise<LoadedHistory> {
  const loadOptions = resolveHistoryLoadOptions(options);
  const headAnchor = await loadHistoryHeadAnchor(options.shell);

  if (headAnchor.status === "unavailable") {
    return createUnavailableHeadHistory(loadOptions);
  }

  const oldestSince = createOldestHistorySince(headAnchor.headAuthoredAtMs, loadOptions);
  const rawHistory = await loadRawHistoryData({
    shell: options.shell,
    pathSpec: loadOptions.pathSpec,
    oldestSince,
    boundedMaxCommits: loadOptions.boundedMaxCommits,
  });
  const totalCommits = parseHistoryCount(rawHistory.countRaw);
  const commits = parseHistoryLog(rawHistory.logRaw);

  return createLoadedHistory({
    loadOptions,
    headAnchor,
    oldestSince,
    totalCommits,
    commits,
    resolvedPath: options.resolvedPath,
  });
}

function resolveHistoryLoadOptions(options: {
  resolvedPath: string;
  windowDays: number[];
  maxCommits: number | undefined;
}): HistoryLoadOptions {
  const requestedMaxCommits = options.maxCommits;
  return {
    requestedMaxCommits,
    boundedMaxCommits: resolveBoundedNumber(requestedMaxCommits, HISTORY_COMMIT_LIMIT_OPTIONS),
    largestWindow:
      options.windowDays[options.windowDays.length - 1] ?? DEFAULT_AUTHORITY_WINDOW_DAYS,
    pathSpec: options.resolvedPath === "." ? "." : options.resolvedPath,
  };
}

async function loadHistoryHeadAnchor(
  shell: CreateStateToolsOptions["shell"],
): Promise<HistoryHeadAnchor> {
  const headRaw = await runProcessText({
    shell,
    cmd: ["git", "log", "-1", `--format=%H%x1f%aI`, "HEAD"],
    maxOutputBytes: historyParseMaxOutputBytes,
    trim: false,
  });
  const [headCommit, headAuthoredAt] = headRaw.trim().split("\u001f");
  const headAuthoredAtMs = parseTimestamp(headAuthoredAt);

  if (!headCommit || !headAuthoredAt || headAuthoredAtMs === null) {
    return { status: "unavailable" };
  }

  return {
    status: "available",
    headCommit,
    headAuthoredAt,
    headAuthoredAtMs,
  };
}

function createUnavailableHeadHistory(loadOptions: HistoryLoadOptions): LoadedHistory {
  return {
    headCommit: null,
    headAuthoredAt: null,
    headAuthoredAtMs: null,
    oldestSince: null,
    totalCommits: 0,
    commits: [],
    bounds: createHistoryBounds({
      requestedMaxCommits: loadOptions.requestedMaxCommits,
      boundedMaxCommits: loadOptions.boundedMaxCommits,
      returned: 0,
      truncated: false,
    }),
    detectionMethod: `${HISTORY_HEAD_ANCHOR_METHOD} + ${HISTORY_DETECTION_METHOD}`,
  };
}

function createOldestHistorySince(
  headAuthoredAtMs: number,
  loadOptions: Pick<HistoryLoadOptions, "largestWindow">,
): string {
  return new Date(headAuthoredAtMs - loadOptions.largestWindow * DAY_MS).toISOString();
}

async function loadRawHistoryData(options: {
  shell: CreateStateToolsOptions["shell"];
  pathSpec: string;
  oldestSince: string;
  boundedMaxCommits: number;
}): Promise<RawHistoryData> {
  const [countRaw, logRaw] = await Promise.all([
    runProcessText({
      shell: options.shell,
      cmd: [
        "git",
        "rev-list",
        "--count",
        "--no-merges",
        `--since=${options.oldestSince}`,
        "HEAD",
        "--",
        options.pathSpec,
      ],
      maxOutputBytes: historyParseMaxOutputBytes,
      trim: false,
    }),
    runProcessText({
      shell: options.shell,
      cmd: [
        "git",
        "log",
        "--find-renames",
        "--no-merges",
        "--numstat",
        "-n",
        String(options.boundedMaxCommits),
        `--since=${options.oldestSince}`,
        `--format=%H%x1f%aI%x1f%an%x1f%ae%x1f%s`,
        "HEAD",
        "--",
        options.pathSpec,
      ],
      maxOutputBytes: historyParseMaxOutputBytes,
      trim: false,
    }),
  ]);

  return { countRaw, logRaw };
}

function parseHistoryCount(raw: string): number {
  return Number.parseInt(raw.trim() || "0", 10) || 0;
}

function createLoadedHistory(options: {
  loadOptions: HistoryLoadOptions;
  headAnchor: Extract<HistoryHeadAnchor, { status: "available" }>;
  oldestSince: string;
  totalCommits: number;
  commits: HistoryCommit[];
  resolvedPath: string;
}): LoadedHistory {
  const truncated = options.totalCommits > options.commits.length;
  return {
    headCommit: options.headAnchor.headCommit,
    headAuthoredAt: options.headAnchor.headAuthoredAt,
    headAuthoredAtMs: options.headAnchor.headAuthoredAtMs,
    oldestSince: options.oldestSince,
    totalCommits: options.totalCommits,
    commits: options.commits,
    bounds: createHistoryBounds({
      requestedMaxCommits: options.loadOptions.requestedMaxCommits,
      boundedMaxCommits: options.loadOptions.boundedMaxCommits,
      returned: options.commits.length,
      truncated,
    }),
    detectionMethod: `${HISTORY_HEAD_ANCHOR_METHOD} + ${HISTORY_DETECTION_METHOD}`,
  };
}

function createHistoryBounds(options: {
  requestedMaxCommits: number | undefined;
  boundedMaxCommits: number;
  returned: number;
  truncated: boolean;
}): HistorySummary["bounds"] {
  return {
    requested: options.requestedMaxCommits,
    limit: options.boundedMaxCommits,
    returned: options.returned,
    truncated: options.truncated,
  };
}
