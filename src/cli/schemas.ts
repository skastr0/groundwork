import { z } from "zod";

const RootDirSchema = z.string().min(1).optional();
const DirectorySchema = z.string().min(1).optional();
const BaseSchema = z.string().min(1).optional();

export const RiskEvaluateCommandInputSchema = z.object({
  command: z.string().min(1),
  config: z
    .object({
      mode: z.enum(["block", "warn", "off"]).optional(),
      includeExtendedRules: z.boolean().optional(),
      allowTempRecursiveForceRm: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const ContextDiscoverInputSchema = z.object({
  target_path: z.string().min(1),
  directory: DirectorySchema,
  root_dir: RootDirSchema,
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

export const CodexInstallProjectInputSchemaContract = {
  schema_id: "groundwork.codex.install-project.input/v1",
  command_id: "codex.install-project",
  command: "codex install-project",
  description: "Install Groundwork hooks and skill files into a project .codex/ directory.",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      target_dir: { type: "string", minLength: 1 },
      hook_command: { type: "string", minLength: 1 },
      force: { type: "boolean" },
    },
  },
} as const;

export const CodexInstallUserInputSchemaContract = {
  schema_id: "groundwork.codex.install-user.input/v1",
  command_id: "codex.install-user",
  command: "codex install-user",
  description: "Install Groundwork hooks and skill files into CODEX_HOME.",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      codex_home: { type: "string", minLength: 1 },
      hook_command: { type: "string", minLength: 1 },
      force: { type: "boolean" },
    },
  },
} as const;

const SessionBaseProperties = {
  session_id: { type: "string", minLength: 1 },
  root_dir: { type: "string", minLength: 1 },
} as const;

const SessionGetInputSchemaContract = {
  schema_id: "groundwork.session.get.input/v1",
  command_id: "session.get",
  command: "session get",
  description: "Read one Groundwork durable session artifact state.",
  schema: {
    type: "object",
    required: ["session_id"],
    additionalProperties: false,
    properties: SessionBaseProperties,
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

const SessionAppendTraceInputSchemaContract = {
  schema_id: "groundwork.session.append-trace.input/v1",
  command_id: "session.append-trace",
  command: "session append-trace",
  description: "Append a trace record to one Groundwork session artifact.",
  schema: {
    type: "object",
    required: ["session_id", "trace"],
    additionalProperties: false,
    properties: {
      ...SessionBaseProperties,
      trace: { type: "object" },
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

export type RiskEvaluateCommandInput = z.infer<typeof RiskEvaluateCommandInputSchema>;
export type ContextDiscoverInput = z.infer<typeof ContextDiscoverInputSchema>;
export type ProvenanceRepoStateInput = z.infer<typeof ProvenanceRepoStateInputSchema>;
export type ProvenanceFileStateInput = z.infer<typeof ProvenanceFileStateInputSchema>;
export type PolicyEvaluateToolCallInput = z.infer<typeof PolicyEvaluateToolCallInputSchema>;
export type PolicyEvaluateToolResultInput = z.infer<typeof PolicyEvaluateToolResultInputSchema>;
export type PolicyOverrideInput = z.infer<typeof PolicyOverrideInputSchema>;
export type PolicySkillLoadedInput = z.infer<typeof PolicySkillLoadedInputSchema>;

export const SCHEMA_CONTRACTS = [
  CodexInstallProjectInputSchemaContract,
  CodexInstallUserInputSchemaContract,
  SessionGetInputSchemaContract,
  SessionSkillLoadedInputSchemaContract,
  SessionOverrideInputSchemaContract,
  SessionRememberActionInputSchemaContract,
  SessionPutPendingToolInputSchemaContract,
  SessionAppendTraceInputSchemaContract,
  SessionCleanupInputSchemaContract,
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
    description: "Accept a human policy override and clear pending override locks.",
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
    schema_id: "groundwork.context.discover.input/v1",
    command_id: "context.discover",
    command: "context discover",
    description: "Discover inherited AGENTS.md / CLAUDE.md instruction files for a target path.",
    schema: {
      type: "object",
      required: ["target_path"],
      additionalProperties: false,
      properties: {
        target_path: { type: "string", minLength: 1 },
        directory: { type: "string", minLength: 1 },
        root_dir: { type: "string", minLength: 1 },
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
] as const;
