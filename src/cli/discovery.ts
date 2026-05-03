import { SCHEMA_CONTRACTS } from "./schemas.ts";

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
    command_id: "provenance.repo-state",
    command: "provenance repo-state",
    name: "Inspect current repo state",
    args: [`{"limit":10}`],
  },
  {
    command_id: "provenance.file-state",
    command: "provenance file-state",
    name: "Inspect one file",
    args: [`{"path":"src/index.ts"}`],
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
