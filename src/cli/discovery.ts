import { DIRECT_PROVENANCE_CLI_COMMAND_NAMES, SCHEMA_CONTRACTS } from "./schemas.ts";

export const CLI_NAME = "groundwork";
export const CLI_VERSION = "0.1.0";

export const COMMAND_CAPABILITIES = [
  {
    command_id: "doctor",
    command: "doctor",
    category: "diagnostic",
    description: "Inspect local runtime health.",
  },
  {
    command_id: "capabilities",
    command: "capabilities",
    category: "discovery",
    description: "Describe supported protocol conventions and commands.",
  },
  {
    command_id: "codex.doctor",
    command: "codex doctor",
    category: "diagnostic",
    description: "Inspect Codex plugin/config integration readiness.",
  },
  {
    command_id: "codex.install-project",
    command: "codex install-project",
    category: "integration",
    description: "Install Groundwork hooks and skill into a project .codex/ directory.",
    schemas: ["groundwork.codex.install-project.input/v1"],
  },
  {
    command_id: "codex.install-user",
    command: "codex install-user",
    category: "integration",
    description: "Install Groundwork hooks and skill into CODEX_HOME.",
    schemas: ["groundwork.codex.install-user.input/v1"],
  },
  {
    command_id: "codex.hook",
    command: "codex hook",
    category: "integration",
    description: "Codex lifecycle hook entrypoint used by hooks.json.",
  },
  {
    command_id: "risk.evaluate-command",
    command: "risk evaluate-command",
    category: "workflow",
    description: "Evaluate shell command risk using Groundwork risk rules.",
    schemas: ["groundwork.risk.evaluate-command.input/v1"],
  },
  {
    command_id: "context.discover",
    command: "context discover",
    category: "workflow",
    description: "Discover inherited instruction files for a target path.",
    schemas: ["groundwork.context.discover.input/v1"],
  },
  {
    command_id: "context.touched-paths",
    command: "context touched-paths",
    category: "workflow",
    description: "Discover inherited instruction files for hook-style touched paths with session dedupe.",
    schemas: ["groundwork.context.touched-paths.input/v1"],
  },
  {
    command_id: "policy.evaluate-tool-call",
    command: "policy evaluate-tool-call",
    category: "workflow",
    description: "Evaluate one pre-tool call against Groundwork policy.",
    schemas: ["groundwork.policy.evaluate-tool-call.input/v1"],
  },
  {
    command_id: "policy.evaluate-tool-result",
    command: "policy evaluate-tool-result",
    category: "workflow",
    description: "Evaluate one completed tool call against post-mutation policy.",
    schemas: ["groundwork.policy.evaluate-tool-result.input/v1"],
  },
  {
    command_id: "policy.override",
    command: "policy override",
    category: "workflow",
    description: "Accept a human policy override and clear pending override locks.",
    schemas: ["groundwork.policy.override.input/v1"],
  },
  {
    command_id: "policy.skill-loaded",
    command: "policy skill-loaded",
    category: "workflow",
    description: "Confirm required policy skills for one session.",
    schemas: ["groundwork.policy.skill-loaded.input/v1"],
  },
  {
    command_id: "provenance.repo-state",
    command: "provenance repo-state",
    category: "workflow",
    description: "Inspect local repository state.",
    schemas: ["groundwork.provenance.repo-state.input/v1"],
  },
  {
    command_id: "provenance.file-state",
    command: "provenance file-state",
    category: "workflow",
    description: "Inspect one file across local git layers.",
    schemas: ["groundwork.provenance.file-state.input/v1"],
  },
  {
    command_id: "provenance.run",
    command: "provenance run",
    category: "workflow",
    description: "Run any registered gw_* provenance tool through the shared local registry.",
    schemas: ["groundwork.provenance.run.input/v1"],
  },
  ...DIRECT_PROVENANCE_CLI_COMMAND_NAMES.map((name) => ({
    command_id: `provenance.${name}`,
    command: `provenance ${name}`,
    category: "workflow",
    description: `Run gw_${name.replace(/-/g, "_")} through the shared local provenance registry.`,
    schemas: [`groundwork.provenance.${name}.input/v1`],
  })),
  {
    command_id: "session.get",
    command: "session get",
    category: "workflow",
    description: "Read one Groundwork durable session artifact state.",
    schemas: ["groundwork.session.get.input/v1"],
  },
  {
    command_id: "session.skill-loaded",
    command: "session skill-loaded",
    category: "workflow",
    description: "Persist required-skill confirmation state for one session.",
    schemas: ["groundwork.session.skill-loaded.input/v1"],
  },
  {
    command_id: "session.override",
    command: "session override",
    category: "workflow",
    description: "Persist a human override record for one session.",
    schemas: ["groundwork.session.override.input/v1"],
  },
  {
    command_id: "session.remember-action",
    command: "session remember-action",
    category: "workflow",
    description: "Persist an action dedupe key for one session.",
    schemas: ["groundwork.session.remember-action.input/v1"],
  },
  {
    command_id: "session.put-pending-tool",
    command: "session put-pending-tool",
    category: "workflow",
    description: "Persist a pending tool snapshot for one session.",
    schemas: ["groundwork.session.put-pending-tool.input/v1"],
  },
  {
    command_id: "session.append-trace",
    command: "session append-trace",
    category: "workflow",
    description: "Append a trace record to one Groundwork session artifact.",
    schemas: ["groundwork.session.append-trace.input/v1"],
  },
  {
    command_id: "session.cleanup",
    command: "session cleanup",
    category: "maintenance",
    description: "Remove one session artifact or stale session artifacts.",
    schemas: ["groundwork.session.cleanup.input/v1"],
  },
  {
    command_id: "session.render-compaction",
    command: "session render-compaction",
    category: "workflow",
    description: "Render compact Groundwork session context from durable artifacts.",
    schemas: ["groundwork.session.render-compaction.input/v1"],
  },
] as const;

export const EXAMPLES = [
  {
    command_id: "risk.evaluate-command",
    command: "risk evaluate-command",
    name: "Block risky git checkout",
    args: [`{"command":"git checkout -- src/index.ts"}`],
  },
  {
    command_id: "codex.install-project",
    command: "codex install-project",
    name: "Install project-local Codex integration",
    args: [`{"target_dir":".","hook_command":"groundwork codex hook","force":false}`],
  },
  {
    command_id: "codex.install-user",
    command: "codex install-user",
    name: "Install user-level Codex integration",
    args: [`{"hook_command":"groundwork codex hook","force":false}`],
  },
  {
    command_id: "context.discover",
    command: "context discover",
    name: "Find inherited instructions for a file",
    args: [`{"target_path":"src/index.ts"}`],
  },
  {
    command_id: "context.touched-paths",
    command: "context touched-paths",
    name: "Render new context reminders for touched paths",
    args: [
      `{"session_id":"example","tool":"edit","args":{"path":"src/index.ts"}}`,
    ],
  },
  {
    command_id: "provenance.repo-state",
    command: "provenance repo-state",
    name: "Inspect current repo state",
    args: [`{"limit":10}`],
  },
  {
    command_id: "policy.evaluate-tool-call",
    command: "policy evaluate-tool-call",
    name: "Evaluate a file edit against policy",
    args: [
      `{"session_id":"example","tool":"edit","call_id":"call-1","args":{"path":"src/index.ts"}}`,
    ],
  },
  {
    command_id: "policy.skill-loaded",
    command: "policy skill-loaded",
    name: "Confirm policy skills for a hook session",
    args: [`{"session_id":"example","skills":["sdlc"]}`],
  },
  {
    command_id: "provenance.file-state",
    command: "provenance file-state",
    name: "Inspect one file",
    args: [`{"path":"src/index.ts"}`],
  },
  {
    command_id: "provenance.run",
    command: "provenance run",
    name: "Run any gw_* provenance tool",
    args: [`{"tool":"gw_worktree_overview","args":{"limit":10}}`],
  },
  {
    command_id: "provenance.read",
    command: "provenance read",
    name: "Read a file with provenance evidence",
    args: [`{"path":"src/index.ts","max_bytes":4000}`],
  },
  {
    command_id: "session.skill-loaded",
    command: "session skill-loaded",
    name: "Confirm skills for a hook session",
    args: [`{"session_id":"example","skills":["groundwork"]}`],
  },
  {
    command_id: "session.cleanup",
    command: "session cleanup",
    name: "Remove stale session artifacts",
    args: [`{"older_than_days":30}`],
  },
  {
    command_id: "session.render-compaction",
    command: "session render-compaction",
    name: "Render compact session context",
    args: [`{"session_id":"example"}`],
  },
] as const;

export function renderCapabilities() {
  return {
    cli: {
      name: CLI_NAME,
      version: CLI_VERSION,
    },
    protocol_version: "groundwork-cli/v1",
    input_modes: ["inline-json", "@file", "stdin"],
    output: {
      success: { stream: "stdout", envelope: "{ ok: true, command, data }" },
      failure: { stream: "stderr", envelope: "{ ok: false, command, error }" },
    },
    commands: COMMAND_CAPABILITIES,
    ambient_integrations: {
      codex_hooks: "best-effort guardrails; not a complete enforcement boundary",
      opencode_hooks: "runtime wrapper can preserve before/after hook semantics",
    },
  };
}

export function renderDoctor() {
  return {
    cli: {
      name: CLI_NAME,
      version: CLI_VERSION,
    },
    runtime: {
      name: "bun",
      version: Bun.version,
    },
    status: "ok",
    checks: [
      {
        name: "runtime.bun",
        ok: true,
        details: { version: Bun.version },
      },
    ],
  };
}

export function listSchemas() {
  return {
    schemas: SCHEMA_CONTRACTS.map(({ schema, ...contract }) => contract),
  };
}

export function showSchema(target: string) {
  const schema = SCHEMA_CONTRACTS.find(
    (entry) =>
      entry.schema_id === target || entry.command_id === target || entry.command === target,
  );
  if (!schema) {
    throw new Error(`No schema found for '${target}'`);
  }
  return schema;
}

export function listExamples() {
  return {
    examples: EXAMPLES.map(({ args, ...example }) => example),
  };
}

export function showExamples(target: string) {
  const examples = EXAMPLES.filter(
    (entry) => entry.command_id === target || entry.command === target,
  );
  if (examples.length === 0) {
    throw new Error(`No examples found for '${target}'`);
  }
  return {
    command_id: examples[0]?.command_id,
    command: examples[0]?.command,
    examples,
  };
}
