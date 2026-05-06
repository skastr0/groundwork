import { type Dirent } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import {
  DEFAULT_EFFECT_CONCURRENCY,
  readDirectoryResult as readDirectoryOutcome,
  readFileResult as readFileOutcome,
  statPath,
} from "../../shared/effect-runtime.ts";
import {
  DEFAULT_PROVENANCE_BYTE_LIMIT,
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
  resolveBoundedNumber,
  type BoundedNumberRuntimeOptions,
} from "./tooling/args.ts";
import type {
  ProvenanceBounds,
  ProvenanceConfidence,
  ProvenanceEvidenceSource,
  ProvenanceWarning,
} from "./tooling/contracts.ts";
import type { TraceContributor, TraceRecord } from "./trace/types.ts";

const AGENTS_DIR = ".agents";
const MESSAGES_DIR = path.join(AGENTS_DIR, "messages");
const SDLC_DIR = path.join(AGENTS_DIR, "sdlc");
const TRACES_DIR = path.join(AGENTS_DIR, "traces");
const SDLC_PHASES = [
  "backlog",
  "exploring",
  "committed",
  "building",
  "reviewing",
  "done",
  "abandoned",
] as const;
const MAX_MESSAGE_SUMMARY_BYTES = 240;
const MAX_TRACE_RANGES = 5;
const MAX_MESSAGE_FILES_SCANNED = 64;
const MAX_TRACE_FILES_SCANNED = 32;
const MAX_WORK_ITEM_FILES_SCANNED = 64;
const MAX_LOCAL_EVIDENCE_FILE_BYTES = 256_000;
const SPAN_TRACE_MATCH_MODE_VALUES = ["exact", "heuristic", "none"] as const;
const SPAN_TRACE_MATCH_KIND_VALUES = ["exact_span", "path_only"] as const;
const TRACE_CONTRIBUTOR_TYPE_VALUES = ["human", "ai", "mixed", "unknown"] as const;
export const LOCAL_EVIDENCE_STATUS_VALUES = ["available", "unavailable", "unsupported"] as const;
export type LocalEvidenceStatus = (typeof LOCAL_EVIDENCE_STATUS_VALUES)[number];

export const LOCAL_EVIDENCE_SOURCE_VALUES = ["messages", "work_items", "traces"] as const;
export type LocalEvidenceSourceName = (typeof LOCAL_EVIDENCE_SOURCE_VALUES)[number];

export const DEFAULT_LOCAL_EVIDENCE_SOURCE_LIMIT = {
  defaultValue: 8,
  maxValue: 50,
} satisfies BoundedNumberRuntimeOptions;

export const DEFAULT_LOCAL_EVIDENCE_BYTE_LIMIT = {
  defaultValue: 6000,
  maxValue: DEFAULT_PROVENANCE_BYTE_LIMIT.maxValue,
  minValue: 256,
} satisfies BoundedNumberRuntimeOptions;

export interface LocalPathEvidenceAnchor {
  kind: "path";
  path: string;
  aliases: string[];
}

interface LocalEvidenceItemBase {
  id: string;
  score: number;
  reasons: string[];
}

export interface LocalMessageEvidenceItem extends LocalEvidenceItemBase {
  kind: "message";
  packet: string;
  from: string;
  phase: string;
  type: string;
  timestamp: string;
  summary: string;
  workItem?: string;
  parentPacket?: string;
  linkedWorkItemID?: string;
  matchedAliases: string[];
}

export interface LocalWorkItemEvidenceItem extends LocalEvidenceItemBase {
  kind: "work_item";
  path: string;
  phase: string;
  title: string;
  workItemID?: string;
  acceptance: {
    total: number;
    completed: number;
  };
  matchedAliases: string[];
}

export interface LocalTraceEvidenceItem extends LocalEvidenceItemBase {
  kind: "trace";
  traceFile: string;
  recordID: string;
  matchedPath: string;
  timestamp: string;
  sessionID?: string;
  vcsRevision?: string;
  agent?: string;
  model?: string;
  observedTool?: string;
  strategy?: string;
  budget?: {
    maxBytes: number;
    usedBytes: number;
  };
  ranges: Array<{
    startLine: number;
    endLine: number;
    contentHash?: string;
  }>;
}

export type LocalSpanTraceMatchMode = (typeof SPAN_TRACE_MATCH_MODE_VALUES)[number];
export type LocalSpanTraceMatchKind = (typeof SPAN_TRACE_MATCH_KIND_VALUES)[number];
export type LocalTraceContributorType = (typeof TRACE_CONTRIBUTOR_TYPE_VALUES)[number];

export interface LocalTraceContributorSnapshot {
  type: LocalTraceContributorType;
  modelID?: string;
}

export interface LocalSpanTraceRange {
  startLine: number;
  endLine: number;
  overlapStartLine?: number;
  overlapEndLine?: number;
  contentHash?: string;
  contributor?: LocalTraceContributorSnapshot;
}

export interface LocalSpanTraceEvidenceItem extends LocalEvidenceItemBase {
  kind: "trace";
  traceFile: string;
  recordID: string;
  matchedPath: string;
  timestamp: string;
  sessionID?: string;
  vcsRevision?: string;
  agent?: string;
  model?: string;
  contributor?: LocalTraceContributorSnapshot;
  matchKind: LocalSpanTraceMatchKind;
  confidence: ProvenanceConfidence;
  heuristic: boolean;
  ranges: LocalSpanTraceRange[];
}

export type LocalEvidenceMatch =
  | LocalMessageEvidenceItem
  | LocalWorkItemEvidenceItem
  | LocalTraceEvidenceItem;

type AvailableLocalEvidenceSource<TItem extends LocalEvidenceMatch> = {
  source: LocalEvidenceSourceName;
  directory: string;
  status: "available";
  items: TItem[];
  totalMatches: number;
  bounds: ProvenanceBounds;
  warnings: ProvenanceWarning[];
};

type UnavailableLocalEvidenceSource = {
  source: LocalEvidenceSourceName;
  directory: string;
  status: "unavailable";
  code: "directory_missing";
  message: string;
};

type UnsupportedLocalEvidenceSource = {
  source: LocalEvidenceSourceName;
  directory: string;
  status: "unsupported";
  code: "disabled_by_caller";
  message: string;
};

export type LocalEvidenceSourceResult<TItem extends LocalEvidenceMatch> =
  | AvailableLocalEvidenceSource<TItem>
  | UnavailableLocalEvidenceSource
  | UnsupportedLocalEvidenceSource;

export interface LocalPathEvidenceRanking {
  items: LocalEvidenceMatch[];
  bounds: ProvenanceBounds;
  bytes: ProvenanceBounds;
}

export interface LocalPathEvidenceResult {
  anchor: LocalPathEvidenceAnchor;
  sources: {
    messages: LocalEvidenceSourceResult<LocalMessageEvidenceItem>;
    workItems: LocalEvidenceSourceResult<LocalWorkItemEvidenceItem>;
    traces: LocalEvidenceSourceResult<LocalTraceEvidenceItem>;
  };
  ranked: LocalPathEvidenceRanking;
}

export interface LocalPathEvidenceOptions {
  rootDir: string;
  path: string;
  aliases?: string[];
  includeMessages?: boolean;
  includeWorkItems?: boolean;
  includeTraces?: boolean;
  perSourceLimit?: number;
  maxItems?: number;
  maxBytes?: number;
}

export type LocalSpanTraceEvidenceSourceResult =
  | {
      source: "traces";
      directory: string;
      status: "available";
      matchMode: LocalSpanTraceMatchMode;
      items: LocalSpanTraceEvidenceItem[];
      totalMatches: number;
      exactMatches: number;
      heuristicMatches: number;
      bounds: ProvenanceBounds;
      warnings: ProvenanceWarning[];
    }
  | {
      source: "traces";
      directory: string;
      status: "unavailable";
      code: "directory_missing";
      message: string;
    };

export interface LocalSpanTraceEvidenceOptions {
  rootDir: string;
  path: string;
  aliases?: string[];
  startLine: number;
  endLine: number;
  limit?: number;
}

export interface LocalSpanTraceEvidenceResult {
  anchor: LocalPathEvidenceAnchor;
  span: {
    startLine: number;
    endLine: number;
  };
  source: LocalSpanTraceEvidenceSourceResult;
}

type LocalTraceObservedPathMatch = {
  matchedPath: string;
  toolName?: string;
  callID?: string;
  strategy?: string;
  budget?: {
    maxBytes: number;
    usedBytes: number;
  };
};

type LocalTraceRecordMatch = {
  traceFile: string;
  record: TraceRecord;
  matchedPaths: string[];
  observedMatches: LocalTraceObservedPathMatch[];
};

type SpanTraceEvidenceCommonFields = Omit<
  LocalSpanTraceEvidenceItem,
  "id" | "matchKind" | "confidence" | "heuristic" | "ranges" | "score" | "reasons"
>;

type SpanTraceEvidenceBuckets = {
  exactItems: LocalSpanTraceEvidenceItem[];
  heuristicItems: LocalSpanTraceEvidenceItem[];
};

type Packet = {
  from?: unknown;
  phase?: unknown;
  type?: unknown;
  content?: unknown;
  metadata?: unknown;
};

type ReadDirectoryResult =
  | {
      status: "available";
      entries: Dirent[];
    }
  | {
      status: "unavailable";
    };

type SafeReadFileResult =
  | {
      status: "available";
      content: string;
    }
  | {
      status: "missing";
    }
  | {
      status: "too_large";
      size: number;
    };

type WorkItemMatchRecord = {
  item: LocalWorkItemEvidenceItem;
  lookupKeys: string[];
};

const PHASE_WEIGHTS: Record<string, number> = {
  building: 25,
  committed: 20,
  reviewing: 18,
  exploring: 12,
  done: 8,
  backlog: 4,
  abandoned: 0,
  build: 12,
  review: 10,
  commit: 8,
  explore: 6,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toNormalizedPath = (value: string): string => value.replace(/\\/g, "/").replace(/^\.\//, "");

const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isPathInsideRoot = (rootDir: string, targetPath: string): boolean => {
  const relative = path.relative(rootDir, targetPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const resolveAnchor = (
  rootDir: string,
  targetPath: string,
  extraAliases: string[] = [],
): LocalPathEvidenceAnchor => {
  const normalizedTarget = toNormalizedPath(targetPath.trim());
  const candidateAliases = new Set<string>();

  const addAlias = (value: string | undefined): void => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    candidateAliases.add(toNormalizedPath(trimmed));
  };

  addAlias(normalizedTarget);
  addAlias(targetPath);

  if (path.isAbsolute(targetPath) && isPathInsideRoot(rootDir, targetPath)) {
    addAlias(path.relative(rootDir, targetPath));
  }

  for (const alias of extraAliases) {
    addAlias(alias);
    if (path.isAbsolute(alias) && isPathInsideRoot(rootDir, alias)) {
      addAlias(path.relative(rootDir, alias));
    }
  }

  const aliases = [...candidateAliases]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  return {
    kind: "path",
    path: aliases[0] ?? normalizedTarget,
    aliases,
  };
};

const normalizeWorkItemKey = (value: unknown): string =>
  (toTrimmedString(value) ?? "").replace(/\.md$/i, "").toLowerCase();

const truncateTextByBytes = (value: unknown, maxBytes: number): string => {
  const trimmed = toTrimmedString(value) ?? "";
  if (!trimmed) return "";
  if (Buffer.byteLength(trimmed, "utf8") <= maxBytes) return trimmed;

  const suffix = "...";
  let end = trimmed.length;
  while (end > 0 && Buffer.byteLength(`${trimmed.slice(0, end)}${suffix}`, "utf8") > maxBytes) {
    end -= 1;
  }

  return `${trimmed.slice(0, end).trimEnd()}${suffix}`;
};

const createPacketWarning = (
  code: string,
  message: string,
  ambiguity: ProvenanceWarning["ambiguity"] = "low",
): ProvenanceWarning => ({
  code,
  message,
  ambiguity,
});

const resolvePacketContent = (packet: Packet): Record<string, unknown> | undefined =>
  isRecord(packet.content) ? packet.content : undefined;

const resolvePacketMetadata = (packet: Packet): Record<string, unknown> | undefined =>
  isRecord(packet.metadata) ? packet.metadata : undefined;

const resolveCanonicalPacketMetadata = (packet: Packet): Record<string, unknown> | undefined => {
  const metadata = resolvePacketMetadata(packet);
  return toTrimmedString(metadata?.schema_id) ? metadata : undefined;
};

const resolvePacketWorkItemRef = (
  packet: Packet,
):
  | {
      plugin?: string;
      path?: string;
      id?: string;
    }
  | undefined => {
  const metadata = resolveCanonicalPacketMetadata(packet);
  const candidate = metadata?.work_item_ref;
  if (!isRecord(candidate)) {
    return undefined;
  }

  const plugin = toTrimmedString(candidate.plugin);
  const workItemPath = toTrimmedString(candidate.path);
  const id = toTrimmedString(candidate.id);
  if (!plugin && !workItemPath && !id) {
    return undefined;
  }

  return {
    ...(plugin ? { plugin } : {}),
    ...(workItemPath ? { path: toNormalizedPath(workItemPath) } : {}),
    ...(id ? { id } : {}),
  };
};

const resolvePacketPhase = (packet: Packet): string => {
  if (!resolveCanonicalPacketMetadata(packet)) {
    return "unknown";
  }

  return toTrimmedString(packet.phase) ?? "unknown";
};

const resolvePacketType = (packet: Packet): string => {
  if (!resolveCanonicalPacketMetadata(packet)) {
    return "unknown";
  }

  return toTrimmedString(packet.type) ?? "unknown";
};

const resolvePacketFrom = (packet: Packet): string => {
  if (!resolveCanonicalPacketMetadata(packet)) {
    return "unknown";
  }

  return toTrimmedString(packet.from) ?? "unknown";
};

const resolvePacketWorkItem = (packet: Packet): string | undefined => {
  const workItemRef = resolvePacketWorkItemRef(packet);

  return workItemRef?.id ?? workItemRef?.path;
};

const resolvePacketParentPacket = (packet: Packet): string | undefined => {
  return toTrimmedString(resolveCanonicalPacketMetadata(packet)?.parent_packet);
};

const resolvePacketTimestamp = (packet: Packet): string =>
  toTrimmedString(resolveCanonicalPacketMetadata(packet)?.timestamp) ?? "";

const resolvePacketSummary = (options: {
  packet: Packet;
  fileName: string;
  phase: string;
  type: string;
}): {
  summary: string;
  warnings: ProvenanceWarning[];
} => {
  const content = resolvePacketContent(options.packet);
  const canonicalMetadata = resolveCanonicalPacketMetadata(options.packet);
  if (!canonicalMetadata) {
    return {
      summary: `Packet artifact: ${options.fileName}`,
      warnings: [
        createPacketWarning(
          "packet_envelope_noncanonical",
          `Packet '${options.fileName}' is missing required metadata.schema_id; surfaced as a raw artifact only.`,
        ),
      ],
    };
  }

  const directSummary = toTrimmedString(content?.summary);
  if (directSummary) {
    return {
      summary: directSummary,
      warnings: [],
    };
  }

  return {
    summary: `Packet artifact: ${options.fileName}`,
    warnings: [
      createPacketWarning(
        "packet_summary_missing",
        `Packet '${options.fileName}' is missing canonical content.summary; surfaced as a raw artifact only.`,
      ),
    ],
  };
};

const findMatchedAliases = (value: string, aliases: readonly string[]): string[] => {
  const normalized = toNormalizedPath(value);
  return aliases.filter((alias) => alias.length > 0 && normalized.includes(alias));
};

const parseTimestamp = (value: string | undefined): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) return direct;

  let normalized = trimmed.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})(\.\d+)?(Z)?$/,
    "$1:$2:$3$4$5",
  );
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const compareRankedEvidence = (left: LocalEvidenceMatch, right: LocalEvidenceMatch): number => {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const leftTimestamp = "timestamp" in left ? parseTimestamp(left.timestamp) : null;
  const rightTimestamp = "timestamp" in right ? parseTimestamp(right.timestamp) : null;
  if (leftTimestamp !== rightTimestamp) {
    return (rightTimestamp ?? -1) - (leftTimestamp ?? -1);
  }

  return left.id.localeCompare(right.id);
};

const evidenceByteSize = (item: LocalEvidenceMatch): number =>
  Buffer.byteLength(JSON.stringify(item), "utf8");

const applyByteBudget = <TItem>(
  items: readonly TItem[],
  requested: number | undefined,
  options: BoundedNumberRuntimeOptions,
  getSize: (item: TItem) => number,
): {
  items: TItem[];
  bounds: ProvenanceBounds;
} => {
  const limit = resolveBoundedNumber(requested, options);
  let used = 0;
  let truncated = false;
  const boundedItems: TItem[] = [];

  for (const item of items) {
    const size = getSize(item);
    if (used + size > limit) {
      truncated = true;
      break;
    }
    boundedItems.push(item);
    used += size;
  }

  return {
    items: boundedItems,
    bounds: {
      requested,
      limit,
      returned: used,
      truncated: truncated || boundedItems.length !== items.length,
    },
  };
};

const unsupportedSource = <TItem extends LocalEvidenceMatch>(
  source: LocalEvidenceSourceName,
  directory: string,
  message: string,
): LocalEvidenceSourceResult<TItem> => ({
  source,
  directory,
  status: "unsupported",
  code: "disabled_by_caller",
  message,
});

const unavailableSource = <TItem extends LocalEvidenceMatch>(
  source: LocalEvidenceSourceName,
  directory: string,
): LocalEvidenceSourceResult<TItem> => ({
  source,
  directory,
  status: "unavailable",
  code: "directory_missing",
  message: `Local evidence source '${directory}' is not available in this workspace.`,
});

const availableSource = <TItem extends LocalEvidenceMatch>(options: {
  source: LocalEvidenceSourceName;
  directory: string;
  items: TItem[];
  requestedLimit: number | undefined;
  warnings: ProvenanceWarning[];
}): LocalEvidenceSourceResult<TItem> => {
  const bounded = applyBoundedLimit(
    options.items,
    options.requestedLimit,
    DEFAULT_LOCAL_EVIDENCE_SOURCE_LIMIT,
  );

  return {
    source: options.source,
    directory: options.directory,
    status: "available",
    items: bounded.items,
    totalMatches: options.items.length,
    bounds: bounded.bounds,
    warnings: options.warnings,
  };
};

const readDirectory = async (directory: string): Promise<ReadDirectoryResult> => {
  const result = await readDirectoryOutcome(directory);
  return result.status === "available"
    ? { status: "available", entries: result.entries }
    : { status: "unavailable" };
};

const safeReadFile = async (
  filePath: string,
  maxBytes: number = MAX_LOCAL_EVIDENCE_FILE_BYTES,
): Promise<SafeReadFileResult> => {
  try {
    const stats = await statPath(filePath);
    if (stats.size > maxBytes) {
      return { status: "too_large", size: stats.size };
    }
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }

  const result = await readFileOutcome(filePath);
  if (result.status === "available") {
    return { status: "available", content: result.content };
  }
  if (result.status === "missing") {
    return { status: "missing" };
  }
  throw result.error;
};

function sortEvidenceEntries(entries: readonly Dirent[]): Dirent[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

function takeEvidenceEntries(
  entries: readonly Dirent[],
  limit: number,
): {
  entries: Dirent[];
  truncated: boolean;
} {
  const sorted = sortEvidenceEntries(entries);
  return {
    entries: sorted.slice(0, limit),
    truncated: sorted.length > limit,
  };
}

const getPhaseWeight = (phase: string | undefined): number => PHASE_WEIGHTS[phase ?? ""] ?? 0;

const toModelID = (record: TraceRecord): string | undefined => {
  const metadata = isRecord(record.metadata) ? record.metadata : undefined;
  const sessionContext =
    metadata && isRecord(metadata["session_context"]) ? metadata["session_context"] : undefined;
  const model =
    sessionContext && isRecord(sessionContext["model"]) ? sessionContext["model"] : undefined;
  const modelID = typeof model?.["modelID"] === "string" ? model["modelID"] : undefined;
  const providerID = typeof model?.["providerID"] === "string" ? model["providerID"] : undefined;
  if (!modelID) return undefined;
  return providerID ? `${providerID}/${modelID}` : modelID;
};

const toTraceSessionID = (record: TraceRecord): string | undefined => {
  const metadata = isRecord(record.metadata) ? record.metadata : undefined;
  const session = metadata && isRecord(metadata["session"]) ? metadata["session"] : undefined;
  return typeof session?.["sessionID"] === "string" ? session["sessionID"] : undefined;
};

const toTraceAgent = (record: TraceRecord): string | undefined => {
  const metadata = isRecord(record.metadata) ? record.metadata : undefined;
  const sessionContext =
    metadata && isRecord(metadata["session_context"]) ? metadata["session_context"] : undefined;
  return typeof sessionContext?.["agent"] === "string" ? sessionContext["agent"] : undefined;
};

const toTraceObservedPathMatches = (
  record: TraceRecord,
  aliases: readonly string[],
): LocalTraceObservedPathMatch[] => {
  const metadata = isRecord(record.metadata) ? record.metadata : undefined;
  const session = metadata && isRecord(metadata["session"]) ? metadata["session"] : undefined;
  const observedTools = Array.isArray(session?.["observedTools"]) ? session["observedTools"] : [];

  return observedTools.flatMap((observedTool) => {
    if (!isRecord(observedTool)) {
      return [];
    }

    const observedMetadata = isRecord(observedTool["metadata"])
      ? observedTool["metadata"]
      : undefined;
    const matchedPath = toTrimmedString(observedMetadata?.["path"]);
    if (!matchedPath) {
      return [];
    }

    const normalizedPath = toNormalizedPath(matchedPath);
    if (!aliases.includes(normalizedPath)) {
      return [];
    }

    const budgetRecord = isRecord(observedTool["budget"]) ? observedTool["budget"] : undefined;
    const maxBytes =
      typeof budgetRecord?.["maxBytes"] === "number" && Number.isInteger(budgetRecord["maxBytes"])
        ? budgetRecord["maxBytes"]
        : undefined;
    const usedBytes =
      typeof budgetRecord?.["usedBytes"] === "number" && Number.isInteger(budgetRecord["usedBytes"])
        ? budgetRecord["usedBytes"]
        : undefined;

    return [
      {
        matchedPath: normalizedPath,
        toolName: toTrimmedString(observedTool["tool"]),
        callID: toTrimmedString(observedTool["callID"]),
        strategy: toTrimmedString(observedTool["strategy"]),
        budget:
          maxBytes !== undefined && usedBytes !== undefined
            ? {
                maxBytes,
                usedBytes,
              }
            : undefined,
      },
    ];
  });
};

const toLookupKeys = (relativePath: string, workItemID?: string): string[] => {
  const basename = path.basename(relativePath, ".md");
  const keys = [normalizeWorkItemKey(relativePath), normalizeWorkItemKey(basename)];
  if (workItemID) {
    keys.push(normalizeWorkItemKey(workItemID));
  }
  return [...new Set(keys.filter(Boolean))];
};

const parseWorkItemContent = (options: {
  phase: string;
  relativePath: string;
  content: string;
  aliases: string[];
}): WorkItemMatchRecord | null => {
  const matchedAliases = findMatchedAliases(options.content, options.aliases);
  if (matchedAliases.length === 0) {
    return null;
  }

  const titleMatch = options.content.match(/^#\s+(.+)$/m);
  const idMatch = options.content.match(/^id:\s*(.+)$/m);
  const acceptanceMatches = Array.from(options.content.matchAll(/^- \[(x|X| )\]\s+/gm));
  const completed = acceptanceMatches.filter((match) => match[1]?.toLowerCase() === "x").length;
  const workItemID = idMatch?.[1]?.trim();
  const reasons = ["path_reference"];
  if (["building", "committed", "reviewing", "exploring"].includes(options.phase)) {
    reasons.push("active_phase");
  }

  return {
    item: {
      kind: "work_item",
      id: options.relativePath,
      path: options.relativePath,
      phase: options.phase,
      title: titleMatch?.[1]?.trim() ?? path.basename(options.relativePath, ".md"),
      workItemID,
      acceptance: {
        total: acceptanceMatches.length,
        completed,
      },
      matchedAliases,
      score: 200 + getPhaseWeight(options.phase) + matchedAliases.length * 5 + (workItemID ? 2 : 0),
      reasons,
    },
    lookupKeys: toLookupKeys(options.relativePath, workItemID),
  };
};

const loadWorkItemEvidence = async (options: {
  rootDir: string;
  anchor: LocalPathEvidenceAnchor;
  enabled: boolean;
  requestedLimit: number | undefined;
}): Promise<{
  source: LocalEvidenceSourceResult<LocalWorkItemEvidenceItem>;
  matchesByKey: Map<string, LocalWorkItemEvidenceItem>;
}> => {
  const directory = SDLC_DIR;
  if (!options.enabled) {
    return {
      source: unsupportedSource(
        "work_items",
        directory,
        "Work-item evidence is disabled for this query.",
      ),
      matchesByKey: new Map(),
    };
  }

  const rootDirectory = path.join(options.rootDir, directory);
  const availability = await readDirectory(rootDirectory);
  if (availability.status === "unavailable") {
    return {
      source: unavailableSource("work_items", directory),
      matchesByKey: new Map(),
    };
  }

  const items: WorkItemMatchRecord[] = [];
  const warnings: ProvenanceWarning[] = [];
  let scannedFiles = 0;
  let scanTruncated = false;

  phaseLoop: for (const phase of SDLC_PHASES) {
    const phaseDirectory = path.join(rootDirectory, phase);
    const phaseEntries = await readDirectory(phaseDirectory);
    if (phaseEntries.status === "unavailable") continue;

    for (const entry of takeEvidenceEntries(phaseEntries.entries, MAX_WORK_ITEM_FILES_SCANNED)
      .entries) {
      if (scannedFiles >= MAX_WORK_ITEM_FILES_SCANNED) {
        scanTruncated = true;
        break phaseLoop;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      scannedFiles += 1;
      const absolutePath = path.join(phaseDirectory, entry.name);
      const content = await safeReadFile(absolutePath);
      if (content.status === "missing") continue;
      if (content.status === "too_large") {
        warnings.push({
          code: "work_item_file_skipped_large",
          message: `Skipped oversized work item '${path.relative(options.rootDir, absolutePath)}' (${content.size} byte(s)).`,
          ambiguity: "low",
        });
        continue;
      }
      const parsed = parseWorkItemContent({
        phase,
        relativePath: path.relative(options.rootDir, absolutePath),
        content: content.content,
        aliases: options.anchor.aliases,
      });
      if (parsed) {
        items.push(parsed);
      }
    }
  }

  if (scanTruncated) {
    warnings.push({
      code: "work_item_scan_limited",
      message: `Work-item evidence scan stopped after ${MAX_WORK_ITEM_FILES_SCANNED} file(s) to stay bounded.`,
      ambiguity: "low",
    });
  }

  items.sort((left, right) => compareRankedEvidence(left.item, right.item));
  const matchesByKey = new Map<string, LocalWorkItemEvidenceItem>();
  for (const match of items) {
    for (const key of match.lookupKeys) {
      matchesByKey.set(key, match.item);
    }
  }

  return {
    source: availableSource({
      source: "work_items",
      directory,
      items: items.map((match) => match.item),
      requestedLimit: options.requestedLimit,
      warnings,
    }),
    matchesByKey,
  };
};

const parsePacket = (raw: string): Packet | null => {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const loadMessageEvidence = async (options: {
  rootDir: string;
  anchor: LocalPathEvidenceAnchor;
  enabled: boolean;
  requestedLimit: number | undefined;
  matchedWorkItems: Map<string, LocalWorkItemEvidenceItem>;
}): Promise<LocalEvidenceSourceResult<LocalMessageEvidenceItem>> => {
  const directory = MESSAGES_DIR;
  if (!options.enabled) {
    return unsupportedSource("messages", directory, "Message evidence is disabled for this query.");
  }

  const messagesDirectory = path.join(options.rootDir, directory);
  const availability = await readDirectory(messagesDirectory);
  if (availability.status === "unavailable") {
    return unavailableSource("messages", directory);
  }

  const items: LocalMessageEvidenceItem[] = [];
  const warnings: ProvenanceWarning[] = [];
  const selectedEntries = takeEvidenceEntries(
    availability.entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")),
    MAX_MESSAGE_FILES_SCANNED,
  );

  if (selectedEntries.truncated) {
    warnings.push({
      code: "message_scan_limited",
      message: `Message evidence scan stopped after ${MAX_MESSAGE_FILES_SCANNED} file(s) to stay bounded.`,
      ambiguity: "low",
    });
  }

  for (const entry of selectedEntries.entries) {
    const absolutePath = path.join(messagesDirectory, entry.name);
    const raw = await safeReadFile(absolutePath);
    if (raw.status === "missing") continue;
    if (raw.status === "too_large") {
      warnings.push({
        code: "message_file_skipped_large",
        message: `Skipped oversized message packet '${entry.name}' (${raw.size} byte(s)).`,
        ambiguity: "low",
      });
      continue;
    }
    const packet = parsePacket(raw.content);
    if (!packet) {
      warnings.push({
        code: "invalid_packet_json",
        message: `Skipped unreadable packet '${entry.name}'.`,
        ambiguity: "low",
      });
      continue;
    }

    const matchedAliases = findMatchedAliases(raw.content, options.anchor.aliases);
    const workItem = resolvePacketWorkItem(packet);
    const workItemKey = normalizeWorkItemKey(workItem) || undefined;
    const linkedWorkItem = workItemKey ? options.matchedWorkItems.get(workItemKey) : undefined;

    if (matchedAliases.length === 0 && !linkedWorkItem) continue;

    const phase = resolvePacketPhase(packet);
    const type = resolvePacketType(packet);
    const from = resolvePacketFrom(packet);
    const summary = resolvePacketSummary({
      packet,
      fileName: entry.name,
      phase,
      type,
    });
    const reasons = matchedAliases.length > 0 ? ["path_reference"] : [];
    if (linkedWorkItem) {
      reasons.push("linked_work_item");
    }
    warnings.push(...summary.warnings);

    items.push({
      kind: "message",
      id: path.relative(options.rootDir, absolutePath),
      packet: path.relative(options.rootDir, absolutePath),
      from,
      phase,
      type,
      timestamp: resolvePacketTimestamp(packet),
      summary: truncateTextByBytes(summary.summary, MAX_MESSAGE_SUMMARY_BYTES),
      workItem,
      parentPacket: resolvePacketParentPacket(packet),
      linkedWorkItemID: linkedWorkItem?.workItemID,
      matchedAliases,
      score: 100 + getPhaseWeight(phase) + matchedAliases.length * 5 + (linkedWorkItem ? 20 : 0),
      reasons,
    });
  }

  items.sort(compareRankedEvidence);

  return availableSource({
    source: "messages",
    directory,
    items,
    requestedLimit: options.requestedLimit,
    warnings,
  });
};

const isTraceRecord = (value: unknown): value is TraceRecord =>
  isRecord(value) &&
  typeof value["version"] === "string" &&
  typeof value["id"] === "string" &&
  typeof value["timestamp"] === "string" &&
  Array.isArray(value["files"]);

const parseTraceRecord = (raw: string): TraceRecord | null => {
  try {
    const parsed = JSON.parse(raw);
    return isTraceRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const toTraceRanges = (
  record: TraceRecord,
  matchedPath: string,
): LocalTraceEvidenceItem["ranges"] => {
  const matchedFile = record.files.find((file) => toNormalizedPath(file.path) === matchedPath);
  if (!matchedFile) return [];

  return matchedFile.conversations
    .flatMap((conversation) => conversation.ranges)
    .filter((range) => Number.isInteger(range.start_line) && Number.isInteger(range.end_line))
    .slice(0, MAX_TRACE_RANGES)
    .map((range) => ({
      startLine: range.start_line,
      endLine: range.end_line,
      contentHash: range.content_hash,
    }));
};

const compareSpanTraceEvidence = (
  left: LocalSpanTraceEvidenceItem,
  right: LocalSpanTraceEvidenceItem,
): number => {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const leftTimestamp = parseTimestamp(left.timestamp);
  const rightTimestamp = parseTimestamp(right.timestamp);
  if (leftTimestamp !== rightTimestamp) {
    return (rightTimestamp ?? -1) - (leftTimestamp ?? -1);
  }

  return left.id.localeCompare(right.id);
};

const toLocalTraceContributor = (
  contributor: TraceContributor | undefined,
): LocalTraceContributorSnapshot | undefined => {
  if (!contributor) return undefined;

  return {
    type: contributor.type,
    modelID: contributor.model_id,
  };
};

const toSpanTraceCandidates = (options: {
  record: TraceRecord;
  matchedPath: string;
  startLine: number;
  endLine: number;
}): {
  exactRanges: LocalSpanTraceRange[];
  heuristicRanges: LocalSpanTraceRange[];
  contributor?: LocalTraceContributorSnapshot;
  distance: number;
} => {
  const matchedFile = options.record.files.find(
    (file) => toNormalizedPath(file.path) === options.matchedPath,
  );
  if (!matchedFile) {
    return {
      exactRanges: [],
      heuristicRanges: [],
      distance: Number.POSITIVE_INFINITY,
    };
  }

  const ranges = matchedFile.conversations.flatMap((conversation) =>
    conversation.ranges
      .filter((range) => Number.isInteger(range.start_line) && Number.isInteger(range.end_line))
      .map((range) => {
        const contributor = toLocalTraceContributor(range.contributor ?? conversation.contributor);
        const overlapStartLine = Math.max(range.start_line, options.startLine);
        const overlapEndLine = Math.min(range.end_line, options.endLine);
        const exactMatch = overlapStartLine <= overlapEndLine;
        const distance = exactMatch
          ? 0
          : range.end_line < options.startLine
            ? options.startLine - range.end_line
            : range.start_line - options.endLine;

        return {
          startLine: range.start_line,
          endLine: range.end_line,
          overlapStartLine: exactMatch ? overlapStartLine : undefined,
          overlapEndLine: exactMatch ? overlapEndLine : undefined,
          contentHash: range.content_hash,
          contributor,
          exactMatch,
          distance,
        };
      }),
  );

  const exactRanges = ranges
    .filter((range) => range.exactMatch)
    .map(({ exactMatch: _exactMatch, distance: _distance, ...range }) => range);
  if (exactRanges.length > 0) {
    return {
      exactRanges: exactRanges.slice(0, MAX_TRACE_RANGES),
      heuristicRanges: [],
      contributor: exactRanges[0]?.contributor,
      distance: 0,
    };
  }

  const heuristicRanges = ranges
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.startLine - right.startLine;
    })
    .slice(0, MAX_TRACE_RANGES)
    .map(({ exactMatch: _exactMatch, distance: _distance, ...range }) => range);

  return {
    exactRanges: [],
    heuristicRanges,
    contributor: heuristicRanges[0]?.contributor,
    distance: ranges[0]?.distance ?? Number.POSITIVE_INFINITY,
  };
};

function selectTraceEntries(
  entries: Dirent[],
  warnings: ProvenanceWarning[],
): Dirent[] {
  const selectedEntries = takeEvidenceEntries(
    entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")),
    MAX_TRACE_FILES_SCANNED,
  );

  if (selectedEntries.truncated) {
    warnings.push({
      code: "trace_scan_limited",
      message: `Trace evidence scan stopped after ${MAX_TRACE_FILES_SCANNED} file(s) to stay bounded.`,
      ambiguity: "low",
    });
  }

  return selectedEntries.entries;
}

async function readLocalTraceRecordMatches(options: {
  rootDir: string;
  tracesDirectory: string;
  entries: Dirent[];
  aliases: string[];
  warnings: ProvenanceWarning[];
}): Promise<LocalTraceRecordMatch[]> {
  const matches: LocalTraceRecordMatch[] = [];

  for (const entry of selectTraceEntries(options.entries, options.warnings)) {
    const absolutePath = path.join(options.tracesDirectory, entry.name);
    const raw = await safeReadFile(absolutePath);
    if (raw.status === "missing") continue;
    if (raw.status === "too_large") {
      options.warnings.push({
        code: "trace_file_skipped_large",
        message: `Skipped oversized trace file '${entry.name}' (${raw.size} byte(s)).`,
        ambiguity: "low",
      });
      continue;
    }

    for (const line of raw.content
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)) {
      const record = parseTraceRecord(line);
      if (!record) {
        options.warnings.push({
          code: "invalid_trace_record",
          message: `Skipped unreadable trace record from '${entry.name}'.`,
          ambiguity: "low",
        });
        continue;
      }

      const matchedPaths = record.files
        .map((file) => toNormalizedPath(file.path))
        .filter((filePath) => options.aliases.includes(filePath));
      const observedMatches = toTraceObservedPathMatches(record, options.aliases);
      if (matchedPaths.length === 0 && observedMatches.length === 0) {
        continue;
      }

      matches.push({
        traceFile: path.relative(options.rootDir, absolutePath),
        record,
        matchedPaths,
        observedMatches,
      });
    }
  }

  return matches;
}

export async function loadLocalSpanTraceEvidence(
  options: LocalSpanTraceEvidenceOptions,
): Promise<LocalSpanTraceEvidenceResult> {
  const anchor = resolveAnchor(options.rootDir, options.path, options.aliases);
  const directory = TRACES_DIR;
  const tracesDirectory = path.join(options.rootDir, directory);
  const availability = await readDirectory(tracesDirectory);

  if (availability.status === "unavailable") {
    return createUnavailableSpanTraceEvidenceResult({ options, anchor, directory });
  }

  const warnings: ProvenanceWarning[] = [];
  const traceMatches = await readLocalTraceRecordMatches({
    rootDir: options.rootDir,
    tracesDirectory,
    entries: availability.entries,
    aliases: anchor.aliases,
    warnings,
  });
  const { exactItems, heuristicItems } = collectSpanTraceEvidenceItems({
    traceMatches,
    startLine: options.startLine,
    endLine: options.endLine,
  });
  const selection = selectSpanTraceEvidenceItems({ exactItems, heuristicItems });
  const source = createAvailableSpanTraceEvidenceSource({
    directory,
    exactItems,
    heuristicItems,
    selectedItems: selection.items,
    matchMode: selection.matchMode,
    limit: options.limit,
    warnings,
  });

  return {
    anchor,
    span: toRequestedSpan(options),
    source,
  };
}

function createUnavailableSpanTraceEvidenceResult(params: {
  options: LocalSpanTraceEvidenceOptions;
  anchor: LocalPathEvidenceAnchor;
  directory: string;
}): LocalSpanTraceEvidenceResult {
  return {
    anchor: params.anchor,
    span: toRequestedSpan(params.options),
    source: {
      source: "traces",
      directory: params.directory,
      status: "unavailable",
      code: "directory_missing",
      message: `Local evidence source '${params.directory}' is not available in this workspace.`,
    },
  };
}

function toRequestedSpan(options: Pick<LocalSpanTraceEvidenceOptions, "startLine" | "endLine">): {
  startLine: number;
  endLine: number;
} {
  return {
    startLine: options.startLine,
    endLine: options.endLine,
  };
}

function collectSpanTraceEvidenceItems(params: {
  traceMatches: LocalTraceRecordMatch[];
  startLine: number;
  endLine: number;
}): SpanTraceEvidenceBuckets {
  const exactItems: LocalSpanTraceEvidenceItem[] = [];
  const heuristicItems: LocalSpanTraceEvidenceItem[] = [];

  for (const match of params.traceMatches) {
    collectSpanTraceMatchItems({
      match,
      startLine: params.startLine,
      endLine: params.endLine,
      exactItems,
      heuristicItems,
    });
  }

  return { exactItems, heuristicItems };
}

function collectSpanTraceMatchItems(params: {
  match: LocalTraceRecordMatch;
  startLine: number;
  endLine: number;
  exactItems: LocalSpanTraceEvidenceItem[];
  heuristicItems: LocalSpanTraceEvidenceItem[];
}): void {
  const { match, exactItems, heuristicItems } = params;
  for (const matchedPath of match.matchedPaths) {
    const candidates = toSpanTraceCandidates({
      record: match.record,
      matchedPath,
      startLine: params.startLine,
      endLine: params.endLine,
    });
    const common = createSpanTraceCommonFields({
      match,
      matchedPath,
      contributor: candidates.contributor,
    });

    if (candidates.exactRanges.length > 0) {
      exactItems.push({
        ...common,
        id: `${common.traceFile}:${match.record.id}:${matchedPath}:exact`,
        matchKind: "exact_span",
        confidence: "high",
        heuristic: false,
        ranges: candidates.exactRanges,
        score: 400 + candidates.exactRanges.length * 10,
        reasons: ["exact_path_match", "exact_line_overlap"],
      });
      continue;
    }

    if (candidates.heuristicRanges.length === 0) continue;

    heuristicItems.push({
      ...common,
      id: `${common.traceFile}:${match.record.id}:${matchedPath}:heuristic`,
      matchKind: "path_only",
      confidence: "low",
      heuristic: true,
      ranges: candidates.heuristicRanges,
      score: 150 - Math.min(candidates.distance, 100),
      reasons: ["exact_path_match", "path_only_heuristic"],
    });
  }
}

function createSpanTraceCommonFields(params: {
  match: LocalTraceRecordMatch;
  matchedPath: string;
  contributor?: LocalTraceContributorSnapshot;
}): SpanTraceEvidenceCommonFields {
  return {
    kind: "trace",
    traceFile: params.match.traceFile,
    recordID: params.match.record.id,
    matchedPath: params.matchedPath,
    timestamp: params.match.record.timestamp,
    sessionID: toTraceSessionID(params.match.record),
    vcsRevision: params.match.record.vcs?.revision,
    agent: toTraceAgent(params.match.record),
    model: toModelID(params.match.record),
    contributor: params.contributor,
  };
}

function selectSpanTraceEvidenceItems(buckets: SpanTraceEvidenceBuckets): {
  matchMode: LocalSpanTraceMatchMode;
  items: LocalSpanTraceEvidenceItem[];
} {
  const { exactItems, heuristicItems } = buckets;
  exactItems.sort(compareSpanTraceEvidence);
  heuristicItems.sort(compareSpanTraceEvidence);

  if (exactItems.length > 0) {
    return { matchMode: "exact", items: exactItems };
  }

  if (heuristicItems.length > 0) {
    return { matchMode: "heuristic", items: heuristicItems };
  }

  return { matchMode: "none", items: [] };
}

function createAvailableSpanTraceEvidenceSource(params: {
  directory: string;
  exactItems: LocalSpanTraceEvidenceItem[];
  heuristicItems: LocalSpanTraceEvidenceItem[];
  selectedItems: LocalSpanTraceEvidenceItem[];
  matchMode: LocalSpanTraceMatchMode;
  limit: number | undefined;
  warnings: ProvenanceWarning[];
}): LocalSpanTraceEvidenceSourceResult {
  const bounded = applyBoundedLimit(
    params.selectedItems,
    params.limit,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  return {
    source: "traces",
    directory: params.directory,
    status: "available",
    matchMode: params.matchMode,
    items: bounded.items,
    totalMatches: params.selectedItems.length,
    exactMatches: params.exactItems.length,
    heuristicMatches: params.heuristicItems.length,
    bounds: bounded.bounds,
    warnings: params.warnings,
  };
}

const loadTraceEvidence = async (options: {
  rootDir: string;
  anchor: LocalPathEvidenceAnchor;
  enabled: boolean;
  requestedLimit: number | undefined;
}): Promise<LocalEvidenceSourceResult<LocalTraceEvidenceItem>> => {
  const directory = TRACES_DIR;
  if (!options.enabled) {
    return unsupportedSource("traces", directory, "Trace evidence is disabled for this query.");
  }

  const tracesDirectory = path.join(options.rootDir, directory);
  const availability = await readDirectory(tracesDirectory);
  if (availability.status === "unavailable") {
    return unavailableSource("traces", directory);
  }

  const items: LocalTraceEvidenceItem[] = [];
  const warnings: ProvenanceWarning[] = [];

  const traceMatches = await readLocalTraceRecordMatches({
    rootDir: options.rootDir,
    tracesDirectory,
    entries: availability.entries,
    aliases: options.anchor.aliases,
    warnings,
  });

  for (const match of traceMatches) {
    const matchedPathSet = new Set(match.matchedPaths);

    for (const matchedPath of match.matchedPaths) {
      const ranges = toTraceRanges(match.record, matchedPath);
      items.push({
        kind: "trace",
        id: `${match.traceFile}:${match.record.id}:${matchedPath}`,
        traceFile: match.traceFile,
        recordID: match.record.id,
        matchedPath,
        timestamp: match.record.timestamp,
        sessionID: toTraceSessionID(match.record),
        vcsRevision: match.record.vcs?.revision,
        agent: toTraceAgent(match.record),
        model: toModelID(match.record),
        ranges,
        score: 300 + ranges.length * 5,
        reasons: ["exact_path_match", "trace_ranges"],
      });
    }

    for (const [index, observedMatch] of match.observedMatches.entries()) {
      if (matchedPathSet.has(observedMatch.matchedPath)) {
        continue;
      }

      items.push({
        kind: "trace",
        id: `${match.traceFile}:${match.record.id}:${observedMatch.matchedPath}:${observedMatch.callID ?? `observed-${index}`}`,
        traceFile: match.traceFile,
        recordID: match.record.id,
        matchedPath: observedMatch.matchedPath,
        timestamp: match.record.timestamp,
        sessionID: toTraceSessionID(match.record),
        vcsRevision: match.record.vcs?.revision,
        agent: toTraceAgent(match.record),
        model: toModelID(match.record),
        observedTool: observedMatch.toolName,
        strategy: observedMatch.strategy,
        budget: observedMatch.budget,
        ranges: [],
        score: 260,
        reasons: ["exact_path_match", "observed_tool_metadata"],
      });
    }
  }

  items.sort(compareRankedEvidence);

  return availableSource({
    source: "traces",
    directory,
    items,
    requestedLimit: options.requestedLimit,
    warnings,
  });
};

const sourceItems = <TItem extends LocalEvidenceMatch>(
  source: LocalEvidenceSourceResult<TItem>,
): TItem[] => (source.status === "available" ? source.items : []);

export async function loadLocalPathEvidence(
  options: LocalPathEvidenceOptions,
): Promise<LocalPathEvidenceResult> {
  const anchor = resolveAnchor(options.rootDir, options.path, options.aliases);
  const requestedPerSourceLimit = options.perSourceLimit;

  const workItems = await loadWorkItemEvidence({
    rootDir: options.rootDir,
    anchor,
    enabled: options.includeWorkItems ?? true,
    requestedLimit: requestedPerSourceLimit,
  });

  const { messages, traces } = await Effect.runPromise(
    Effect.all(
      {
        messages: Effect.promise(() =>
          loadMessageEvidence({
            rootDir: options.rootDir,
            anchor,
            enabled: options.includeMessages ?? true,
            requestedLimit: requestedPerSourceLimit,
            matchedWorkItems: workItems.matchesByKey,
          }),
        ),
        traces: Effect.promise(() =>
          loadTraceEvidence({
            rootDir: options.rootDir,
            anchor,
            enabled: options.includeTraces ?? true,
            requestedLimit: requestedPerSourceLimit,
          }),
        ),
      },
      { concurrency: Math.min(DEFAULT_EFFECT_CONCURRENCY, 2) },
    ),
  );

  const allRankedItems = [
    ...sourceItems(messages),
    ...sourceItems(workItems.source),
    ...sourceItems(traces),
  ].sort(compareRankedEvidence);

  const maxItemsLimit = resolveBoundedNumber(options.maxItems, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const itemLimited = allRankedItems.slice(0, maxItemsLimit);
  const byteLimited = applyByteBudget(
    itemLimited,
    options.maxBytes,
    DEFAULT_LOCAL_EVIDENCE_BYTE_LIMIT,
    evidenceByteSize,
  );

  return {
    anchor,
    sources: {
      messages,
      workItems: workItems.source,
      traces,
    },
    ranked: {
      items: byteLimited.items,
      bounds: {
        requested: options.maxItems,
        limit: maxItemsLimit,
        returned: byteLimited.items.length,
        truncated: allRankedItems.length > byteLimited.items.length,
      },
      bytes: byteLimited.bounds,
    },
  };
}

export function toProvenanceEvidenceSource(item: LocalEvidenceMatch): ProvenanceEvidenceSource {
  if (item.kind === "message") {
    return {
      kind: "message",
      id: item.id,
      path: item.packet,
      label: `${item.phase}:${item.type}`,
      detail: item.summary,
    };
  }

  if (item.kind === "work_item") {
    return {
      kind: "work_item",
      id: item.workItemID ?? item.id,
      path: item.path,
      label: item.title,
      detail: `${item.phase} | ${item.acceptance.completed}/${item.acceptance.total} criteria complete`,
    };
  }

  return {
    kind: "trace",
    id: item.id,
    path: item.traceFile,
    ref: item.recordID,
    label: item.matchedPath,
    detail: item.sessionID ? `session ${item.sessionID}` : item.timestamp,
  };
}

export function toProvenanceEvidenceSources(
  items: readonly LocalEvidenceMatch[],
): ProvenanceEvidenceSource[] {
  return items.map((item) => toProvenanceEvidenceSource(item));
}
