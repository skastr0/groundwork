import { randomUUID } from "node:crypto";
import path from "node:path";
import { appendTraceRecords } from "./trace/storage.ts";
import type { TraceObservedTool, TraceRecord } from "./trace/types.ts";
import type {
  EpistemologyFrameworkLayerHooks,
  EpistemologyFrameworkLayerRegistration,
} from "../layer/index.ts";
import {
  createSessionKernelStore,
  extractFrameworkToolTargets,
  FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS,
  truncateFrameworkTextByBytes,
  type FrameworkJsonObject,
  type FrameworkJsonValue,
  type FrameworkPendingToolCall,
  type FrameworkPromptContext,
  type FrameworkSessionKernelState,
  type SessionKernelStore,
} from "../kernel/index.ts";
import { logger } from "../logger/index.ts";
import {
  applyFrameworkAmbientBudget,
  classifyFrameworkAmbientTool,
  type FrameworkAmbientQueryStrategyName,
} from "./classifier.ts";
import type { CreateFrameworkProvenanceToolsOptions } from "./registry.ts";

const FRAMEWORK_SYSTEM_TRANSFORM_LINES = [
  "Epistemology framework reminders:",
  "- worldview: honor inherited `AGENTS.md`/`CLAUDE.md` reminders; deeper files override parents.",
  "- policy: treat guardrails and tool blocks as binding, not puzzles to route around.",
  "- provenance: use `prov_*` tools when history or trust matters, and separate observed evidence from inference.",
] as const;

const FRAMEWORK_POLICY_RUNTIME_METADATA_KEY = "policyRuntime";
const FRAMEWORK_COMPACTION_HEADER = "Epistemology framework context:";
const FRAMEWORK_COMPACTION_WORLDVIEW_PATH_LIMIT = 4;
const FRAMEWORK_COMPACTION_POLICY_ITEM_LIMIT = 4;
const FRAMEWORK_COMPACTION_PENDING_TOOL_LIMIT = 3;
const FRAMEWORK_COMPACTION_TARGET_LIMIT = 3;
const FRAMEWORK_PROVENANCE_CAPTURE_SERVICE = "epistemology-framework-provenance";
const FRAMEWORK_PROVENANCE_THIN_SLICE_TOOLS = new Set(["read"]);
const FRAMEWORK_PROVENANCE_AWARE_TOOL_IDS = new Set(["read", "grep", "edit", "task", "bash"]);
const FRAMEWORK_TOOL_DEFINITION_GUIDANCE_BY_QUERY_STRATEGY = Object.freeze({
  "file-evidence":
    "Provenance: if lineage matters, prefer `prov_read`, `prov_file_state`, or `prov_span_history`.",
  "workspace-evidence":
    "Provenance: if match clusters matter, prefer `prov_tree_expand` or `prov_worktree_overview`.",
  "span-history":
    "Provenance: if recent edits are unclear, inspect `prov_span_history` or `prov_file_state` first.",
  "session-evidence":
    "Provenance: if delegated work needs verification, ask for cited files or commits and confirm with `prov_pr_expand` or `prov_worktree_overview`.",
  "repo-evidence":
    "Provenance: for repo state or recent history, prefer `prov_repo_state`, `prov_worktree_overview`, or `prov_commit_expand`.",
}) satisfies Record<FrameworkAmbientQueryStrategyName, string>;

export const FRAMEWORK_COMPACTION_CONTEXT_MAX_BYTES = 1024;
export const FRAMEWORK_SYSTEM_TRANSFORM_MAX_BYTES = 384;
export const FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE = renderFrameworkSystemTransformGuidance();

interface FrameworkSessionStoreReader {
  get: SessionKernelStore["get"];
}

type FrameworkCompactionHook = NonNullable<
  EpistemologyFrameworkLayerHooks["experimental.session.compacting"]
>;
type FrameworkToolExecuteBeforeHook = NonNullable<
  EpistemologyFrameworkLayerHooks["tool.execute.before"]
>;
type FrameworkToolExecuteAfterHook = NonNullable<
  EpistemologyFrameworkLayerHooks["tool.execute.after"]
>;
type FrameworkToolDefinitionHook = NonNullable<EpistemologyFrameworkLayerHooks["tool.definition"]>;
type FrameworkSystemTransformHook = NonNullable<
  EpistemologyFrameworkLayerHooks["experimental.chat.system.transform"]
>;

export interface CreateFrameworkProvenanceLayerOptions {
  directory?: string;
  now?: () => string;
  sessionStore?: SessionKernelStore;
  shell?: CreateFrameworkProvenanceToolsOptions["shell"];
  rootDir?: CreateFrameworkProvenanceToolsOptions["rootDir"];
}

export async function createFrameworkProvenanceLayer(
  options: CreateFrameworkProvenanceLayerOptions = {},
): Promise<EpistemologyFrameworkLayerRegistration> {
  const directory = path.resolve(options.directory ?? options.rootDir ?? process.cwd());
  const rootDir = path.resolve(options.rootDir ?? options.directory ?? process.cwd());
  const now = options.now ?? (() => new Date().toISOString());
  const sessionStore = options.sessionStore ?? createSessionKernelStore();
  const toolDefinitions =
    typeof options.shell === "function"
      ? (await import("./registry.ts")).createFrameworkProvenanceTools({
          shell: options.shell,
          rootDir,
        })
      : {};

  return {
    active: true,
    toolDefinitions,
    hooks: {
      "tool.execute.before": createFrameworkProvenanceToolBeforeHook({
        directory,
        rootDir,
        sessionStore,
        now,
      }),
      "tool.execute.after": createFrameworkProvenanceToolAfterHook({
        rootDir,
        sessionStore,
        now,
      }),
      "experimental.chat.system.transform": createFrameworkSystemTransformHook(),
      "experimental.session.compacting": createFrameworkCompactionContextHook(sessionStore),
      "tool.definition": createFrameworkToolDefinitionHook(),
      event: async ({ event }) => {
        if (event.type !== "session.deleted") {
          return;
        }

        const sessionID = readEventSessionID(event.properties);
        if (!sessionID) {
          return;
        }

        sessionStore.cleanup(sessionID);
      },
    },
  };
}

export function createFrameworkCompactionContextHook(
  sessionStore: FrameworkSessionStoreReader,
  maxBytes = FRAMEWORK_COMPACTION_CONTEXT_MAX_BYTES,
): FrameworkCompactionHook {
  return async ({ sessionID }, output) => {
    const state = sessionStore.get(sessionID);
    if (!state) {
      return;
    }

    const context = renderFrameworkCompactionContext(state, maxBytes);
    if (!context || output.context.includes(context)) {
      return;
    }

    output.context.push(context);
  };
}

export function createFrameworkSystemTransformHook(
  guidance = FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE,
): FrameworkSystemTransformHook {
  return async (_input, output) => {
    if (!guidance || output.system.includes(guidance)) {
      return;
    }

    output.system.push(guidance);
  };
}

export function renderFrameworkSystemTransformGuidance(
  maxBytes = FRAMEWORK_SYSTEM_TRANSFORM_MAX_BYTES,
): string {
  return renderBoundedLines(FRAMEWORK_SYSTEM_TRANSFORM_LINES, maxBytes);
}

export function createFrameworkToolDefinitionHook(): FrameworkToolDefinitionHook {
  return async ({ toolID }, output) => {
    output.description = augmentFrameworkToolDescription(toolID, output.description);
  };
}

export function augmentFrameworkToolDescription(toolID: string, description: string): string {
  const guidance = renderFrameworkToolDefinitionGuidance(toolID);
  if (!guidance) {
    return description;
  }

  const baseDescription = description.trimEnd();
  if (!baseDescription) {
    return guidance;
  }

  return baseDescription.includes(guidance) ? baseDescription : `${baseDescription} ${guidance}`;
}

export function renderFrameworkToolDefinitionGuidance(toolID: string): string {
  const classification = classifyFrameworkAmbientTool(toolID);
  if (classification.status !== "supported") {
    return "";
  }

  if (!FRAMEWORK_PROVENANCE_AWARE_TOOL_IDS.has(classification.toolName)) {
    return "";
  }

  return FRAMEWORK_TOOL_DEFINITION_GUIDANCE_BY_QUERY_STRATEGY[classification.query.strategy];
}

export function renderFrameworkCompactionContext(
  state: FrameworkSessionKernelState,
  maxBytes = FRAMEWORK_COMPACTION_CONTEXT_MAX_BYTES,
): string {
  const lines = [
    FRAMEWORK_COMPACTION_HEADER,
    renderWorldviewCompactionLine(state),
    renderPolicyCompactionLine(state),
    renderProvenanceCompactionLine(state),
  ].filter((line): line is string => Boolean(line));

  if (lines.length <= 1) {
    return "";
  }

  return renderBoundedLines(lines, maxBytes);
}

function renderWorldviewCompactionLine(state: FrameworkSessionKernelState): string | null {
  const worldviewPaths = collectWorldviewPaths(state);
  if (worldviewPaths.length === 0) {
    return null;
  }

  return `- worldview: injected files ${formatLimitedList(worldviewPaths, FRAMEWORK_COMPACTION_WORLDVIEW_PATH_LIMIT)}`;
}

function collectWorldviewPaths(state: FrameworkSessionKernelState): string[] {
  const entries = Object.values(
    state.caches.buckets[FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS.frameworkActions]?.entries ?? {},
  );
  const paths = new Set<string>();

  for (const entry of entries) {
    const metadata = asJsonObject(entry.metadata);
    const context = asJsonObject(metadata?.context);
    const source = typeof metadata?.source === "string" ? metadata.source : undefined;
    const action = typeof metadata?.action === "string" ? metadata.action : undefined;
    const path = typeof context?.path === "string" ? context.path : undefined;

    if (source === "worldview" && action === "inject-file" && path) {
      paths.add(path);
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

function renderPolicyCompactionLine(state: FrameworkSessionKernelState): string | null {
  const segments: string[] = [];
  const activeLocks = Object.entries(state.locks.active)
    .map(([key, lock]) => `${key} (${lock.scope})`)
    .sort((left, right) => left.localeCompare(right));
  if (activeLocks.length > 0) {
    segments.push(
      `active locks ${formatLimitedList(activeLocks, FRAMEWORK_COMPACTION_POLICY_ITEM_LIMIT)}`,
    );
  }

  const policyRuntime = readPolicyRuntimeMetadata(state.metadata);
  if (policyRuntime.confirmedSkills.length > 0) {
    segments.push(
      `confirmed skills ${formatLimitedList(policyRuntime.confirmedSkills, FRAMEWORK_COMPACTION_POLICY_ITEM_LIMIT)}`,
    );
  }
  if (policyRuntime.completedInjectOnlyRules.length > 0) {
    segments.push(
      `completed prompt-only rules ${formatLimitedList(policyRuntime.completedInjectOnlyRules, FRAMEWORK_COMPACTION_POLICY_ITEM_LIMIT)}`,
    );
  }

  if (segments.length === 0) {
    return null;
  }

  return `- policy: ${segments.join("; ")}`;
}

function renderProvenanceCompactionLine(state: FrameworkSessionKernelState): string | null {
  const segments: string[] = [];

  const promptContext = state.promptContext;
  if (promptContext) {
    const promptSegments = [
      promptContext.role ? `role=${promptContext.role}` : null,
      promptContext.agent ? `agent=${promptContext.agent}` : null,
      promptContext.model
        ? `model=${promptContext.model.providerID}/${promptContext.model.modelID}`
        : null,
      promptContext.variant ? `variant=${promptContext.variant}` : null,
      renderPromptTools(promptContext.tools),
    ].filter((segment): segment is string => Boolean(segment));

    if (promptSegments.length > 0) {
      segments.push(`prompt ${promptSegments.join(" ")}`);
    }
  }

  const pendingTools = Object.values(state.pendingTools.calls)
    .map((call) => {
      const targets = call.targets
        .map(
          (target) => target.normalizedPath ?? target.afterPath ?? target.beforePath ?? target.path,
        )
        .filter((target): target is string => Boolean(target));
      const summary =
        targets.length > 0
          ? formatLimitedList(targets, FRAMEWORK_COMPACTION_TARGET_LIMIT)
          : "no-targets";
      return `${call.toolName}(${summary})`;
    })
    .sort((left, right) => left.localeCompare(right));
  if (pendingTools.length > 0) {
    segments.push(
      `pending tools ${formatLimitedList(pendingTools, FRAMEWORK_COMPACTION_PENDING_TOOL_LIMIT)}`,
    );
  }

  if (segments.length === 0) {
    return null;
  }

  return `- provenance: ${segments.join("; ")}`;
}

function createFrameworkProvenanceToolBeforeHook(options: {
  directory: string;
  rootDir: string;
  sessionStore: SessionKernelStore;
  now: () => string;
}): FrameworkToolExecuteBeforeHook {
  return async ({ tool, callID, sessionID }, { args }) => {
    if (!FRAMEWORK_PROVENANCE_THIN_SLICE_TOOLS.has(tool)) {
      return;
    }

    const classification = classifyFrameworkAmbientTool(tool);
    if (classification.status !== "supported") {
      return;
    }

    const extraction = extractFrameworkToolTargets(asToolArgs(args), {
      toolName: tool,
      directory: options.directory,
      rootDir: options.rootDir,
    });
    const targetPath = pickPendingTargetPath(extraction.targets);
    if (!targetPath) {
      return;
    }

    const state = getOrCreateSessionState(options.sessionStore, sessionID);
    state.pendingTools.calls[createProvenancePendingToolKey(callID)] = {
      callID,
      toolName: tool,
      phase: "after",
      capturedAt: options.now(),
      targets: [
        {
          path: targetPath,
          normalizedPath: targetPath,
        },
      ],
      data: createReadCaptureData(asToolArgs(args), classification.capture.strategy),
    };
    options.sessionStore.set(state);
  };
}

function createFrameworkProvenanceToolAfterHook(options: {
  rootDir: string;
  sessionStore: SessionKernelStore;
  now: () => string;
}): FrameworkToolExecuteAfterHook {
  return async ({ tool, callID, sessionID }) => {
    if (!FRAMEWORK_PROVENANCE_THIN_SLICE_TOOLS.has(tool)) {
      return;
    }

    let state = getOrCreateSessionState(options.sessionStore, sessionID);
    const pendingKey = createProvenancePendingToolKey(callID);
    const pending = state.pendingTools.calls[pendingKey];
    if (!pending) {
      return;
    }

    delete state.pendingTools.calls[pendingKey];

    const capturedAt = options.now();
    const observedTool = createReadObservedTool(pending, capturedAt);
    if (!observedTool) {
      options.sessionStore.set(state);
      return;
    }

    const budgeted = applyFrameworkAmbientBudget(state, [observedTool], {
      toolName: tool,
      phase: "capture",
      now: capturedAt,
      getSize: measureObservedToolBytes,
      metadata: {
        source: FRAMEWORK_PROVENANCE_CAPTURE_SERVICE,
        callID,
        sessionID,
      },
    });
    state = options.sessionStore.set(state);

    if (budgeted.status !== "supported" || budgeted.items.length === 0) {
      logger.warn("Skipped framework provenance capture", {
        tool,
        callID,
        sessionID,
      });
      return;
    }

    const recordedObservedTool = budgeted.items[0];
    if (!recordedObservedTool) {
      return;
    }

    try {
      await appendTraceRecords({
        rootDir: options.rootDir,
        sessionID,
        records: [
          createObservedToolTraceRecord({
            sessionID,
            callID,
            timestamp: capturedAt,
            observedTool: recordedObservedTool,
            promptContext: state.promptContext,
          }),
        ],
      });
    } catch (error) {
      logger.error("Failed to persist framework provenance trace", {
        tool,
        callID,
        sessionID,
        error: toErrorMessage(error),
      });
    }
  };
}

function asToolArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readEventSessionID(properties: unknown): string | null {
  const record = asToolArgs(properties);
  if (!record) {
    return null;
  }

  if (typeof record.id === "string" && record.id.length > 0) {
    return record.id;
  }

  if (typeof record.sessionID === "string" && record.sessionID.length > 0) {
    return record.sessionID;
  }

  return null;
}

function getOrCreateSessionState(
  sessionStore: SessionKernelStore,
  sessionID: string,
): FrameworkSessionKernelState {
  return sessionStore.get(sessionID) ?? sessionStore.create(sessionID);
}

function createProvenancePendingToolKey(callID: string): string {
  return `${FRAMEWORK_PROVENANCE_CAPTURE_SERVICE}::${callID}`;
}

function pickPendingTargetPath(targets: FrameworkPendingToolCall["targets"]): string | null {
  for (const target of targets) {
    const nextPath = target.normalizedPath ?? target.afterPath ?? target.beforePath ?? target.path;
    if (typeof nextPath === "string" && nextPath.length > 0) {
      return nextPath;
    }
  }

  return null;
}

function createReadCaptureData(
  args: Record<string, unknown> | undefined,
  captureStrategy: string,
): FrameworkJsonObject {
  const data: FrameworkJsonObject = {
    source: FRAMEWORK_PROVENANCE_CAPTURE_SERVICE,
    captureStrategy,
  };

  const offset = readIntegerArg(args, "offset");
  if (offset !== undefined) {
    data.offset = offset;
  }

  const limit = readIntegerArg(args, "limit");
  if (limit !== undefined) {
    data.limit = limit;
  }

  return data;
}

function createReadObservedTool(
  pending: FrameworkPendingToolCall,
  capturedAt: string,
): TraceObservedTool | null {
  if (pending.toolName !== "read") {
    return null;
  }

  const classification = classifyFrameworkAmbientTool(pending.toolName);
  if (classification.status !== "supported") {
    return null;
  }
  if (classification.capture.strategy !== "path-only") {
    return null;
  }

  const targetPath = pickPendingTargetPath(pending.targets);
  if (!targetPath) {
    return null;
  }

  const metadata: Record<string, unknown> = {
    path: targetPath,
  };
  const offset = readIntegerValue(pending.data?.offset);
  if (offset !== undefined) {
    metadata.offset = offset;
  }
  const limit = readIntegerValue(pending.data?.limit);
  if (limit !== undefined) {
    metadata.limit = limit;
  }

  return withObservedToolBudget({
    tool: "read",
    callID: pending.callID,
    capturedAt,
    strategy: "path-only",
    metadata,
    budget: {
      maxBytes: classification.capture.budget.byteLimit,
      usedBytes: 0,
    },
  });
}

function withObservedToolBudget(observedTool: TraceObservedTool): TraceObservedTool {
  let nextTool = {
    ...observedTool,
    budget: {
      ...observedTool.budget,
    },
    metadata: {
      ...observedTool.metadata,
    },
    truncatedFields: observedTool.truncatedFields ? [...observedTool.truncatedFields] : undefined,
  };

  while (true) {
    const usedBytes = Buffer.byteLength(JSON.stringify(nextTool), "utf8");
    if (nextTool.budget.usedBytes === usedBytes) {
      return nextTool;
    }

    nextTool = {
      ...nextTool,
      budget: {
        ...nextTool.budget,
        usedBytes,
      },
    };
  }
}

function measureObservedToolBytes(observedTool: TraceObservedTool): number {
  return Buffer.byteLength(JSON.stringify(observedTool), "utf8");
}

function createObservedToolTraceRecord(options: {
  sessionID: string;
  callID: string;
  timestamp: string;
  observedTool: TraceObservedTool;
  promptContext: FrameworkPromptContext | null;
}): TraceRecord {
  return {
    version: "0.1.0",
    id: randomUUID(),
    timestamp: options.timestamp,
    files: [],
    metadata: {
      session: {
        sessionID: options.sessionID,
        toolCalls: 1,
        toolCounts: {
          read: 1,
        },
        callIDs: [options.callID],
        observedTools: [options.observedTool],
      },
      ...(options.promptContext?.agent || options.promptContext?.model
        ? {
            session_context: {
              ...(options.promptContext.agent ? { agent: options.promptContext.agent } : {}),
              ...(options.promptContext.model
                ? {
                    model: {
                      providerID: options.promptContext.model.providerID,
                      modelID: options.promptContext.model.modelID,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  };
}

function readIntegerArg(
  args: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!args) {
    return undefined;
  }

  return readIntegerValue(args[key]);
}

function readIntegerValue(value: FrameworkJsonValue | unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderPromptTools(tools: FrameworkPromptContext["tools"]): string | null {
  if (!tools) {
    return null;
  }

  const entries = Object.entries(tools)
    .filter(([, enabled]) => typeof enabled === "boolean")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([toolName, enabled]) => `${toolName}=${enabled ? "true" : "false"}`);

  return entries.length > 0
    ? `tools ${formatLimitedList(entries, FRAMEWORK_COMPACTION_POLICY_ITEM_LIMIT)}`
    : null;
}

function readPolicyRuntimeMetadata(metadata: FrameworkJsonObject | undefined): {
  completedInjectOnlyRules: string[];
  confirmedSkills: string[];
} {
  const runtime = asJsonObject(metadata?.[FRAMEWORK_POLICY_RUNTIME_METADATA_KEY]);

  return {
    completedInjectOnlyRules: readSortedStringArray(runtime?.completedInjectOnlyRules),
    confirmedSkills: readSortedStringArray(runtime?.confirmedSkills),
  };
}

function readSortedStringArray(value: FrameworkJsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function formatLimitedList(values: readonly string[], limit: number): string {
  const visible = values.slice(0, limit);
  const suffix = values.length > limit ? `, +${values.length - limit} more` : "";
  return `${visible.join(", ")}${suffix}`;
}

function asJsonObject(value: FrameworkJsonValue | undefined): FrameworkJsonObject | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }

  return value as FrameworkJsonObject;
}

function renderBoundedLines(lines: readonly string[], maxBytes: number): string {
  const limit = normalizeMaxBytes(maxBytes);
  if (limit === 0) {
    return "";
  }

  let output = "";

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    const candidate = output ? `${output}\n${line}` : line;
    if (Buffer.byteLength(candidate, "utf8") <= limit) {
      output = candidate;
      continue;
    }

    const prefix = output ? `${output}\n` : "";
    const remainingBytes = Math.max(0, limit - Buffer.byteLength(prefix, "utf8"));
    if (remainingBytes > 0) {
      const truncatedLine = truncateFrameworkTextByBytes(line, remainingBytes);
      if (truncatedLine) {
        output = `${prefix}${truncatedLine}`;
      }
    }
    break;
  }

  return output;
}

function normalizeMaxBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}
