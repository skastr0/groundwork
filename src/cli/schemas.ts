import { z } from "zod";
import {
  FRAMEWORK_PROVENANCE_TOOL_IDS,
} from "@skastr0/groundwork-core/cli-support";

const RootDirSchema = z.string().min(1).optional();
const DirectorySchema = z.string().min(1).optional();
const BaseSchema = z.string().min(1).optional();

export const DIRECT_PROVENANCE_CLI_COMMAND_NAMES = [
  "span-history",
  "diff-expand",
  "commit-materialize",
  "commit-expand",
  "pr-materialize",
  "pr-expand",
  "tree-expand",
  "worktree-overview",
  "hotspots",
  "authority",
  "stability-report",
  "read",
  "block-read",
] as const;

const OptionalLocalModeProperty = { enum: ["local"] } as const;
const OptionalHybridModeProperty = { enum: ["local", "remote", "hybrid"] } as const;
const PathProperty = { type: "string", minLength: 1 } as const;
const BaseProperty = { type: "string", minLength: 1 } as const;
const PositiveIntegerProperty = { type: "integer", minimum: 1 } as const;
const PositiveNumberProperty = { type: "number", exclusiveMinimum: 0 } as const;
const BooleanProperty = { type: "boolean" } as const;

const DirectProvenanceCommandSchemaSpecs = {
  "span-history": {
    required: ["path", "start_line", "end_line"],
    properties: {
      path: PathProperty,
      start_line: PositiveIntegerProperty,
      end_line: PositiveIntegerProperty,
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
    },
  },
  "diff-expand": {
    required: ["path"],
    properties: {
      path: PathProperty,
      base: BaseProperty,
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
      max_items: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
      include_patch: BooleanProperty,
    },
  },
  "commit-materialize": {
    required: ["commit"],
    properties: {
      commit: { type: "string", minLength: 1 },
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
      include_patch: BooleanProperty,
    },
  },
  "commit-expand": {
    required: ["commit"],
    properties: {
      commit: { type: "string", minLength: 1 },
      base: BaseProperty,
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
      max_items: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
      include_patch: BooleanProperty,
    },
  },
  "pr-materialize": {
    required: [],
    properties: {
      pr: PositiveIntegerProperty,
      base: BaseProperty,
      mode: OptionalHybridModeProperty,
      limit: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
    },
  },
  "pr-expand": {
    required: [],
    properties: {
      pr: PositiveIntegerProperty,
      base: BaseProperty,
      mode: OptionalHybridModeProperty,
      limit: PositiveIntegerProperty,
      max_items: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
    },
  },
  "tree-expand": {
    required: ["path"],
    properties: {
      path: PathProperty,
      base: BaseProperty,
      scope: { enum: ["branch", "worktree"] },
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
      max_items: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
      max_depth: PositiveIntegerProperty,
    },
  },
  "worktree-overview": {
    required: [],
    properties: {
      base: BaseProperty,
      scope: { enum: ["branch", "worktree"] },
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
      max_items: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
      max_depth: PositiveIntegerProperty,
    },
  },
  hotspots: {
    required: [],
    properties: {
      path: PathProperty,
      windows: { type: "array", items: PositiveIntegerProperty },
      group_by: { enum: ["file", "directory"] },
      directory_depth: PositiveIntegerProperty,
      limit: PositiveIntegerProperty,
      max_commits: PositiveIntegerProperty,
      mode: OptionalLocalModeProperty,
    },
  },
  authority: {
    required: [],
    properties: {
      path: PathProperty,
      window_days: PositiveIntegerProperty,
      limit: PositiveIntegerProperty,
      max_commits: PositiveIntegerProperty,
      mode: OptionalLocalModeProperty,
    },
  },
  "stability-report": {
    required: [],
    properties: {
      path: PathProperty,
      recent_window_days: PositiveIntegerProperty,
      baseline_window_days: PositiveIntegerProperty,
      limit: PositiveIntegerProperty,
      max_commits: PositiveIntegerProperty,
      mode: OptionalLocalModeProperty,
    },
  },
  read: {
    required: ["path"],
    properties: {
      path: PathProperty,
      layer: { enum: ["base", "head", "index", "worktree"] },
      base: BaseProperty,
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
      max_items: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
    },
  },
  "block-read": {
    required: ["path", "start_line", "end_line"],
    properties: {
      path: PathProperty,
      start_line: PositiveIntegerProperty,
      end_line: PositiveIntegerProperty,
      radius: PositiveNumberProperty,
      window_start: PositiveIntegerProperty,
      window_end: PositiveIntegerProperty,
      layer: { enum: ["base", "head", "index", "worktree"] },
      base: BaseProperty,
      mode: OptionalLocalModeProperty,
      limit: PositiveIntegerProperty,
      max_items: PositiveIntegerProperty,
      max_bytes: PositiveIntegerProperty,
    },
  },
} satisfies Record<
  (typeof DIRECT_PROVENANCE_CLI_COMMAND_NAMES)[number],
  {
    required: readonly string[];
    properties: Record<string, unknown>;
  }
>;

const RiskConfigInputSchema = z
  .object({
    mode: z.enum(["block", "warn", "off"]).optional(),
    includeExtendedRules: z.boolean().optional(),
    allowTempRecursiveForceRm: z.boolean().optional(),
  })
  .strict();

export const RiskEvaluateCommandInputSchema = z.object({
  command: z.string().min(1),
  config: RiskConfigInputSchema.optional(),
}).strict();

export const RiskEvaluateToolCallInputSchema = z.object({
  root_dir: RootDirSchema,
  session_id: z.string().min(1),
  call_id: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  config: RiskConfigInputSchema.optional(),
}).strict();

export const RiskEvaluateToolResultInputSchema = z.object({
  root_dir: RootDirSchema,
  session_id: z.string().min(1),
  call_id: z.string().min(1),
}).strict();

export const ContextDiscoverInputSchema = z.object({
  target_path: z.string().min(1),
  directory: DirectorySchema,
  root_dir: RootDirSchema,
  include_root: z.boolean().optional(),
  include_content: z.boolean().optional(),
}).strict();

export const ContextTouchedPathsInputSchema = z.object({
  root_dir: RootDirSchema,
  directory: DirectorySchema,
  session_id: z.string().min(1),
  include_root: z.boolean().optional(),
  tool: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  targets: z.array(z.record(z.string(), z.unknown())).optional(),
}).strict();

export const ProvenanceRepoStateInputSchema = z.object({
  root_dir: RootDirSchema,
  base: BaseSchema,
  limit: z.number().int().positive().optional(),
}).strict();

export const ProvenanceFileStateInputSchema = z.object({
  path: z.string().min(1),
  root_dir: RootDirSchema,
  base: BaseSchema,
}).strict();

export const ProvenanceToolInputSchema = z.object({
  root_dir: RootDirSchema,
  tool: z.enum(FRAMEWORK_PROVENANCE_TOOL_IDS),
  args: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const ProvenanceToolArgsInputSchema = z.object({
  root_dir: RootDirSchema,
}).catchall(z.unknown());

const PolicyBaseInputSchema = z.object({
  root_dir: RootDirSchema,
  session_id: z.string().min(1),
}).strict();

export const PolicyEvaluateToolCallInputSchema = PolicyBaseInputSchema.extend({
  directory: DirectorySchema,
  tool: z.string().min(1),
  call_id: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  targets: z.array(z.record(z.string(), z.unknown())).optional(),
}).strict();

export const PolicyEvaluateToolResultInputSchema = PolicyBaseInputSchema.extend({
  call_id: z.string().min(1),
  tool: z.string().min(1).optional(),
}).strict();

export const PolicyOverrideInputSchema = PolicyBaseInputSchema.extend({
  reason: z.string().min(1),
  rule_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const PolicySkillLoadedInputSchema = PolicyBaseInputSchema.extend({
  skills: z.array(z.string().min(1)).min(1),
}).strict();

const SessionBaseProperties = {
  session_id: { type: "string", minLength: 1 },
  root_dir: { type: "string", minLength: 1 },
} as const;

const SessionGetInputSchemaContract = {
  schema_id: "groundwork.session.get.input/v1",
  command_id: "session.get",
  command: "session get",
  description: "Read one Groundwork durable session artifact state, or use view=summary for compact counts.",
  schema: {
    type: "object",
    required: ["session_id"],
    additionalProperties: false,
    properties: {
      ...SessionBaseProperties,
      view: { enum: ["full", "summary"] },
    },
  },
} as const;

const SessionSkillLoadedInputSchemaContract = {
  schema_id: "groundwork.session.skill-loaded.input/v1",
  command_id: "session.skill-loaded",
  command: "session skill-loaded",
  description: "Persist required-skill confirmation state for one session.",
  schema: {
    type: "object",
    required: ["session_id", "skills"],
    additionalProperties: false,
    properties: {
      ...SessionBaseProperties,
      skills: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    },
  },
} as const;

const SessionOverrideInputSchemaContract = {
  schema_id: "groundwork.session.override.input/v1",
  command_id: "session.override",
  command: "session override",
  description: "Persist a human override record for one session.",
  schema: {
    type: "object",
    required: ["session_id", "reason"],
    additionalProperties: false,
    properties: {
      ...SessionBaseProperties,
      reason: { type: "string", minLength: 1 },
      rule_id: { type: "string", minLength: 1 },
      metadata: { type: "object" },
    },
  },
} as const;

const SessionRememberActionInputSchemaContract = {
  schema_id: "groundwork.session.remember-action.input/v1",
  command_id: "session.remember-action",
  command: "session remember-action",
  description: "Persist an action dedupe key for one session.",
  schema: {
    type: "object",
    required: ["session_id", "key", "source", "action"],
    additionalProperties: false,
    properties: {
      ...SessionBaseProperties,
      key: { type: "string", minLength: 1 },
      source: { type: "string", minLength: 1 },
      action: { type: "string", minLength: 1 },
      metadata: { type: "object" },
    },
  },
} as const;

const SessionPutPendingToolInputSchemaContract = {
  schema_id: "groundwork.session.put-pending-tool.input/v1",
  command_id: "session.put-pending-tool",
  command: "session put-pending-tool",
  description: "Persist a pending tool snapshot for one session.",
  schema: {
    type: "object",
    required: ["session_id", "call_id", "tool_name"],
    additionalProperties: false,
    properties: {
      ...SessionBaseProperties,
      call_id: { type: "string", minLength: 1 },
      tool_name: { type: "string", minLength: 1 },
      phase: { enum: ["before", "after"] },
      args: { type: "object" },
      targets: { type: "array", items: { type: "object" } },
      data: { type: "object" },
    },
  },
} as const;

const SessionCleanupInputSchemaContract = {
  schema_id: "groundwork.session.cleanup.input/v1",
  command_id: "session.cleanup",
  command: "session cleanup",
  description: "Remove one session artifact or stale session artifacts.",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      root_dir: { type: "string", minLength: 1 },
      session_id: { type: "string", minLength: 1 },
      older_than_days: { type: "integer", minimum: 1 },
    },
  },
} as const;

const SessionRenderCompactionInputSchemaContract = {
  schema_id: "groundwork.session.render-compaction.input/v1",
  command_id: "session.render-compaction",
  command: "session render-compaction",
  description: "Render compact Groundwork session context from durable artifacts.",
  schema: {
    type: "object",
    required: ["session_id"],
    additionalProperties: false,
	    properties: {
	      root_dir: { type: "string", minLength: 1 },
	      session_id: { type: "string", minLength: 1 },
	    },
  },
} as const;

export const SCHEMA_CONTRACTS = [
  SessionGetInputSchemaContract,
  SessionSkillLoadedInputSchemaContract,
  SessionOverrideInputSchemaContract,
  SessionRememberActionInputSchemaContract,
  SessionPutPendingToolInputSchemaContract,
  SessionCleanupInputSchemaContract,
  SessionRenderCompactionInputSchemaContract,
  {
    schema_id: "groundwork.policy.evaluate-tool-call.input/v1",
    command_id: "policy.evaluate-tool-call",
    command: "policy evaluate-tool-call",
    description: "Evaluate one pre-tool call against Groundwork policy.",
    schema: {
      type: "object",
      required: ["session_id", "tool"],
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        directory: { type: "string", minLength: 1 },
        session_id: { type: "string", minLength: 1 },
        tool: { type: "string", minLength: 1 },
        call_id: { type: "string", minLength: 1 },
        args: { type: "object" },
        targets: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    schema_id: "groundwork.policy.evaluate-tool-result.input/v1",
    command_id: "policy.evaluate-tool-result",
    command: "policy evaluate-tool-result",
    description: "Evaluate one completed tool call against post-mutation policy.",
    schema: {
      type: "object",
      required: ["session_id", "call_id"],
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        session_id: { type: "string", minLength: 1 },
        call_id: { type: "string", minLength: 1 },
        tool: { type: "string", minLength: 1 },
      },
    },
  },
  {
    schema_id: "groundwork.policy.override.input/v1",
    command_id: "policy.override",
    command: "policy override",
    description:
      "Record a one-shot human override for audit and clear the pending override lock; does not create durable scoped approval.",
    schema: SessionOverrideInputSchemaContract.schema,
  },
  {
    schema_id: "groundwork.policy.skill-loaded.input/v1",
    command_id: "policy.skill-loaded",
    command: "policy skill-loaded",
    description: "Confirm required policy skills for one session.",
    schema: SessionSkillLoadedInputSchemaContract.schema,
  },
  {
    schema_id: "groundwork.risk.evaluate-command.input/v1",
    command_id: "risk.evaluate-command",
    command: "risk evaluate-command",
    description: "Evaluate one shell command for destructive-risk violations.",
    schema: {
      type: "object",
      required: ["command"],
      additionalProperties: false,
      properties: {
        command: { type: "string", minLength: 1 },
        config: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: { enum: ["block", "warn", "off"] },
            includeExtendedRules: { type: "boolean" },
            allowTempRecursiveForceRm: { type: "boolean" },
          },
        },
      },
    },
  },
  {
    schema_id: "groundwork.risk.evaluate-tool-call.input/v1",
    command_id: "risk.evaluate-tool-call",
    command: "risk evaluate-tool-call",
    description:
      "Evaluate one Bash tool call against destructive-risk rules with session block-once state.",
    schema: {
      type: "object",
      required: ["session_id", "command"],
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        session_id: { type: "string", minLength: 1 },
        call_id: { type: "string", minLength: 1 },
        tool: { type: "string", minLength: 1 },
        command: { type: "string", minLength: 1 },
        cwd: { type: "string", minLength: 1 },
        config: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: { enum: ["block", "warn", "off"] },
            includeExtendedRules: { type: "boolean" },
            allowTempRecursiveForceRm: { type: "boolean" },
          },
        },
      },
    },
  },
  {
    schema_id: "groundwork.risk.evaluate-tool-result.input/v1",
    command_id: "risk.evaluate-tool-result",
    command: "risk evaluate-tool-result",
    description:
      "Report completion for a tool call that previously continued after a risk block-once warning.",
    schema: {
      type: "object",
      required: ["session_id", "call_id"],
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        session_id: { type: "string", minLength: 1 },
        call_id: { type: "string", minLength: 1 },
      },
    },
  },
  {
    schema_id: "groundwork.context.discover.input/v1",
    command_id: "context.discover",
    command: "context discover",
    description:
      "Discover inherited AGENTS.md / CLAUDE.md instruction files for a target path. Root-level files are included only when include_root is true; set include_content=false for metadata-only output.",
    schema: {
      type: "object",
      required: ["target_path"],
      additionalProperties: false,
      properties: {
        target_path: { type: "string", minLength: 1 },
        directory: { type: "string", minLength: 1 },
        root_dir: { type: "string", minLength: 1 },
        include_root: { type: "boolean" },
        include_content: { type: "boolean" },
      },
    },
  },
  {
    schema_id: "groundwork.context.touched-paths.input/v1",
    command_id: "context.touched-paths",
    command: "context touched-paths",
    description: "Discover inherited instruction files for hook-style touched paths with session dedupe. Root-level files are included only when include_root is true.",
    schema: {
      type: "object",
      required: ["session_id"],
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        directory: { type: "string", minLength: 1 },
        session_id: { type: "string", minLength: 1 },
        include_root: { type: "boolean" },
        tool: { type: "string", minLength: 1 },
        args: { type: "object" },
        targets: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    schema_id: "groundwork.provenance.repo-state.input/v1",
    command_id: "provenance.repo-state",
    command: "provenance repo-state",
    description: "Inspect local branch, base, staged, unstaged, and untracked repository state.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        base: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    schema_id: "groundwork.provenance.file-state.input/v1",
    command_id: "provenance.file-state",
    command: "provenance file-state",
    description: "Inspect one file across base, HEAD, index, and worktree layers.",
    schema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1 },
        root_dir: { type: "string", minLength: 1 },
        base: { type: "string", minLength: 1 },
      },
    },
  },
  {
    schema_id: "groundwork.provenance.run.input/v1",
    command_id: "provenance.run",
    command: "provenance run",
    description: "Run any registered gw_* provenance tool through the shared local tool registry.",
    schema: {
      type: "object",
      required: ["tool"],
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        tool: { enum: FRAMEWORK_PROVENANCE_TOOL_IDS },
        args: { type: "object" },
      },
    },
  },
  ...DIRECT_PROVENANCE_CLI_COMMAND_NAMES.map((name) => ({
    schema_id: `groundwork.provenance.${name}.input/v1`,
    command_id: `provenance.${name}`,
    command: `provenance ${name}`,
    description: `Run gw_${name.replace(/-/g, "_")} through the shared local provenance registry.`,
    schema: {
      type: "object",
      required: DirectProvenanceCommandSchemaSpecs[name].required,
      additionalProperties: false,
      properties: {
        root_dir: { type: "string", minLength: 1 },
        ...DirectProvenanceCommandSchemaSpecs[name].properties,
      },
    },
  })),
] as const;
