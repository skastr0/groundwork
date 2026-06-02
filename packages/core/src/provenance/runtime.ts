import path from "node:path";
import type {
  GroundworkLayerHooks,
  GroundworkLayerRegistration,
} from "../layer/dispatcher.ts";
import { createFrameworkSessionCleanupEventHook } from "../layer/session-cleanup.ts";
import {
  createSessionKernelStore,
  type FrameworkJsonObject,
  type FrameworkJsonValue,
  type FrameworkPromptContext,
  type FrameworkSessionKernelState,
  type SessionKernelStore,
} from "../kernel/state.ts";
import {
  FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS,
  truncateFrameworkTextByBytes,
} from "../kernel/helpers.ts";
import {
  classifyFrameworkAmbientTool,
  type FrameworkAmbientQueryStrategyName,
} from "./classifier.ts";
import type { CreateFrameworkProvenanceToolsOptions } from "./registry.ts";

const FRAMEWORK_SYSTEM_TRANSFORM_LINES = [
  "Groundwork reminders:",
  "- context: honor inherited `AGENTS.md`/`CLAUDE.md` reminders; deeper files override parents.",
  "- policy: treat guardrails and tool blocks as binding, not puzzles to route around.",
  "- provenance: use `gw_*` tools when history or trust matters, and separate observed evidence from inference.",
] as const;

const FRAMEWORK_POLICY_RUNTIME_METADATA_KEY = "policyRuntime";
const FRAMEWORK_COMPACTION_HEADER = "Groundwork context:";
const FRAMEWORK_COMPACTION_CONTEXT_PATH_LIMIT = 4;
const FRAMEWORK_COMPACTION_POLICY_ITEM_LIMIT = 4;
const FRAMEWORK_COMPACTION_PENDING_TOOL_LIMIT = 3;
const FRAMEWORK_COMPACTION_TARGET_LIMIT = 3;
const FRAMEWORK_PROVENANCE_AWARE_TOOL_IDS = new Set(["read", "grep", "edit", "task", "bash"]);
const FRAMEWORK_TOOL_DEFINITION_GUIDANCE_BY_QUERY_STRATEGY = Object.freeze({
  "file-evidence":
    "Provenance: if lineage matters, prefer `gw_read`, `gw_file_state`, or `gw_span_history`.",
  "workspace-evidence":
    "Provenance: if match clusters matter, prefer `gw_tree_expand` or `gw_worktree_overview`.",
  "span-history":
    "Provenance: if recent edits are unclear, inspect `gw_span_history` or `gw_file_state` first.",
  "session-evidence":
    "Provenance: if delegated work needs verification, ask for cited files or commits and confirm with `gw_pr_expand` or `gw_worktree_overview`.",
  "repo-evidence":
    "Provenance: for repo state or recent history, prefer `gw_repo_state`, `gw_worktree_overview`, or `gw_commit_expand`.",
}) satisfies Record<FrameworkAmbientQueryStrategyName, string>;

export const FRAMEWORK_COMPACTION_CONTEXT_MAX_BYTES = 1024;
export const FRAMEWORK_SYSTEM_TRANSFORM_MAX_BYTES = 384;
export const FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE = renderFrameworkSystemTransformGuidance();

interface FrameworkSessionStoreReader {
  get: SessionKernelStore["get"];
}

type FrameworkCompactionHook = NonNullable<
  GroundworkLayerHooks["experimental.session.compacting"]
>;
type FrameworkToolDefinitionHook = NonNullable<GroundworkLayerHooks["tool.definition"]>;
type FrameworkSystemTransformHook = NonNullable<
  GroundworkLayerHooks["experimental.chat.system.transform"]
>;

export interface CreateFrameworkProvenanceLayerOptions {
  directory?: string;
  now?: () => string;
  ownSessionCleanup?: boolean;
  sessionStore?: SessionKernelStore;
  shell?: CreateFrameworkProvenanceToolsOptions["shell"];
  rootDir?: CreateFrameworkProvenanceToolsOptions["rootDir"];
}

export async function createFrameworkProvenanceLayer(
  options: CreateFrameworkProvenanceLayerOptions = {},
): Promise<GroundworkLayerRegistration> {
  const rootDir = path.resolve(options.rootDir ?? options.directory ?? process.cwd());
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
      "experimental.chat.system.transform": createFrameworkSystemTransformHook(),
      "experimental.session.compacting": createFrameworkCompactionContextHook(sessionStore),
      "tool.definition": createFrameworkToolDefinitionHook(),
      ...(options.ownSessionCleanup ?? true
        ? { event: createFrameworkSessionCleanupEventHook(sessionStore) }
        : {}),
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
    renderContextCompactionLine(state),
    renderPolicyCompactionLine(state),
    renderProvenanceCompactionLine(state),
  ].filter((line): line is string => Boolean(line));

  if (lines.length <= 1) {
    return "";
  }

  return renderBoundedLines(lines, maxBytes);
}

function renderContextCompactionLine(state: FrameworkSessionKernelState): string | null {
  const contextPaths = collectContextPaths(state);
  if (contextPaths.length === 0) {
    return null;
  }

  return `- context: injected files ${formatLimitedList(contextPaths, FRAMEWORK_COMPACTION_CONTEXT_PATH_LIMIT)}`;
}

function collectContextPaths(state: FrameworkSessionKernelState): string[] {
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

    if (source === "context" && action === "inject-file" && path) {
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
