import {
  applyFrameworkCollectionBudget,
  type ApplyFrameworkBudgetOptions,
  type FrameworkBudgetResult,
  type FrameworkSessionKernelState,
} from "../kernel/index.ts";

export const FRAMEWORK_AMBIENT_PROVENANCE_TOOL_VALUES = [
  "read",
  "grep",
  "glob",
  "edit",
  "apply_patch",
  "task",
  "bash",
] as const;

export type FrameworkAmbientProvenanceToolName =
  (typeof FRAMEWORK_AMBIENT_PROVENANCE_TOOL_VALUES)[number];

export const FRAMEWORK_AMBIENT_CAPTURE_STRATEGY_VALUES = [
  "path-only",
  "path-list",
  "file-diff",
  "session-artifacts",
  "command-metadata",
] as const;

export type FrameworkAmbientCaptureStrategyName =
  (typeof FRAMEWORK_AMBIENT_CAPTURE_STRATEGY_VALUES)[number];

export const FRAMEWORK_AMBIENT_QUERY_STRATEGY_VALUES = [
  "file-evidence",
  "workspace-evidence",
  "span-history",
  "session-evidence",
  "repo-evidence",
] as const;

export type FrameworkAmbientQueryStrategyName =
  (typeof FRAMEWORK_AMBIENT_QUERY_STRATEGY_VALUES)[number];

export type FrameworkAmbientBudgetPhase = "capture" | "query";

export interface FrameworkAmbientStrategyBudget {
  itemLimit: number;
  byteLimit: number;
}

export interface FrameworkAmbientCaptureStrategy {
  strategy: FrameworkAmbientCaptureStrategyName;
  budget: FrameworkAmbientStrategyBudget;
}

export interface FrameworkAmbientQueryStrategy {
  strategy: FrameworkAmbientQueryStrategyName;
  budget: FrameworkAmbientStrategyBudget;
}

export interface FrameworkSupportedAmbientToolClassification {
  status: "supported";
  toolName: FrameworkAmbientProvenanceToolName;
  capture: FrameworkAmbientCaptureStrategy;
  query: FrameworkAmbientQueryStrategy;
}

export interface FrameworkUnsupportedAmbientToolClassification {
  status: "unsupported";
  toolName: string;
  code: "unsupported_tool";
  message: string;
}

export type FrameworkAmbientToolClassification =
  | FrameworkSupportedAmbientToolClassification
  | FrameworkUnsupportedAmbientToolClassification;

export type FrameworkAmbientBudgetApplicationResult<TItem> =
  | ({
      status: "supported";
      toolName: FrameworkAmbientProvenanceToolName;
      phase: FrameworkAmbientBudgetPhase;
      classification: FrameworkSupportedAmbientToolClassification;
    } & FrameworkBudgetResult<TItem>)
  | FrameworkUnsupportedAmbientToolClassification;

export interface ApplyFrameworkAmbientBudgetOptions<TItem> extends Omit<
  ApplyFrameworkBudgetOptions<TItem>,
  "itemLimit" | "byteLimit" | "itemLedgerKey" | "byteLedgerKey"
> {
  toolName: string;
  phase: FrameworkAmbientBudgetPhase;
}

const CAPTURE_BUDGETS = Object.freeze({
  focusedPath: Object.freeze({
    itemLimit: 1,
    byteLimit: 2048,
  }),
  discoveredPaths: Object.freeze({
    itemLimit: 12,
    byteLimit: 4096,
  }),
  mutationTargets: Object.freeze({
    itemLimit: 8,
    byteLimit: 6144,
  }),
  delegatedArtifacts: Object.freeze({
    itemLimit: 4,
    byteLimit: 4096,
  }),
  commandMetadata: Object.freeze({
    itemLimit: 2,
    byteLimit: 2048,
  }),
});

const QUERY_BUDGETS = Object.freeze({
  fileEvidence: Object.freeze({
    itemLimit: 6,
    byteLimit: 4096,
  }),
  workspaceEvidence: Object.freeze({
    itemLimit: 8,
    byteLimit: 6000,
  }),
  spanHistory: Object.freeze({
    itemLimit: 6,
    byteLimit: 6000,
  }),
  sessionEvidence: Object.freeze({
    itemLimit: 6,
    byteLimit: 6000,
  }),
  repoEvidence: Object.freeze({
    itemLimit: 5,
    byteLimit: 4096,
  }),
});

const SUPPORTED_CLASSIFICATIONS = Object.freeze({
  read: Object.freeze({
    status: "supported",
    toolName: "read",
    capture: Object.freeze({
      strategy: "path-only",
      budget: CAPTURE_BUDGETS.focusedPath,
    }),
    query: Object.freeze({
      strategy: "file-evidence",
      budget: QUERY_BUDGETS.fileEvidence,
    }),
  }),
  grep: Object.freeze({
    status: "supported",
    toolName: "grep",
    capture: Object.freeze({
      strategy: "path-list",
      budget: CAPTURE_BUDGETS.discoveredPaths,
    }),
    query: Object.freeze({
      strategy: "workspace-evidence",
      budget: QUERY_BUDGETS.workspaceEvidence,
    }),
  }),
  glob: Object.freeze({
    status: "supported",
    toolName: "glob",
    capture: Object.freeze({
      strategy: "path-list",
      budget: CAPTURE_BUDGETS.discoveredPaths,
    }),
    query: Object.freeze({
      strategy: "workspace-evidence",
      budget: QUERY_BUDGETS.workspaceEvidence,
    }),
  }),
  edit: Object.freeze({
    status: "supported",
    toolName: "edit",
    capture: Object.freeze({
      strategy: "file-diff",
      budget: CAPTURE_BUDGETS.mutationTargets,
    }),
    query: Object.freeze({
      strategy: "span-history",
      budget: QUERY_BUDGETS.spanHistory,
    }),
  }),
  apply_patch: Object.freeze({
    status: "supported",
    toolName: "apply_patch",
    capture: Object.freeze({
      strategy: "file-diff",
      budget: CAPTURE_BUDGETS.mutationTargets,
    }),
    query: Object.freeze({
      strategy: "span-history",
      budget: QUERY_BUDGETS.spanHistory,
    }),
  }),
  task: Object.freeze({
    status: "supported",
    toolName: "task",
    capture: Object.freeze({
      strategy: "session-artifacts",
      budget: CAPTURE_BUDGETS.delegatedArtifacts,
    }),
    query: Object.freeze({
      strategy: "session-evidence",
      budget: QUERY_BUDGETS.sessionEvidence,
    }),
  }),
  bash: Object.freeze({
    status: "supported",
    toolName: "bash",
    capture: Object.freeze({
      strategy: "command-metadata",
      budget: CAPTURE_BUDGETS.commandMetadata,
    }),
    query: Object.freeze({
      strategy: "repo-evidence",
      budget: QUERY_BUDGETS.repoEvidence,
    }),
  }),
}) satisfies Record<
  FrameworkAmbientProvenanceToolName,
  FrameworkSupportedAmbientToolClassification
>;

export const FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS = Object.freeze({
  captureItems: "ambient-provenance-capture-items",
  captureBytes: "ambient-provenance-capture-bytes",
  queryItems: "ambient-provenance-query-items",
  queryBytes: "ambient-provenance-query-bytes",
} as const);

function isSupportedToolName(toolName: string): toolName is FrameworkAmbientProvenanceToolName {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CLASSIFICATIONS, toolName);
}

function unsupportedClassification(
  toolName: string,
): FrameworkUnsupportedAmbientToolClassification {
  return {
    status: "unsupported",
    toolName,
    code: "unsupported_tool",
    message: `Ambient provenance has no target classifier entry for '${toolName}'.`,
  };
}

export function classifyFrameworkAmbientTool(toolName: string): FrameworkAmbientToolClassification {
  if (!isSupportedToolName(toolName)) {
    return unsupportedClassification(toolName);
  }

  return SUPPORTED_CLASSIFICATIONS[toolName];
}

export function applyFrameworkAmbientBudget<TItem>(
  state: FrameworkSessionKernelState,
  items: readonly TItem[],
  options: ApplyFrameworkAmbientBudgetOptions<TItem>,
): FrameworkAmbientBudgetApplicationResult<TItem> {
  const classification = classifyFrameworkAmbientTool(options.toolName);
  if (classification.status === "unsupported") {
    return classification;
  }

  const budget = classification[options.phase].budget;
  const ledgerKeys =
    options.phase === "capture"
      ? {
          item: FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.captureItems,
          bytes: FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.captureBytes,
        }
      : {
          item: FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.queryItems,
          bytes: FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.queryBytes,
        };
  const result = applyFrameworkCollectionBudget(state, items, {
    ...options,
    itemLimit: budget.itemLimit,
    byteLimit: budget.byteLimit,
    itemLedgerKey: ledgerKeys.item,
    byteLedgerKey: ledgerKeys.bytes,
    metadata: {
      toolName: classification.toolName,
      phase: options.phase,
      ...options.metadata,
    },
  });

  return {
    status: "supported",
    toolName: classification.toolName,
    phase: options.phase,
    classification,
    ...result,
  };
}
