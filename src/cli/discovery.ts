import { DIRECT_PROVENANCE_CLI_COMMAND_NAMES, SCHEMA_CONTRACTS } from "./schemas.ts";

export const CLI_NAME = "groundwork";
export const CLI_VERSION = "0.1.1";

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
    command_id: "schema.list",
    command: "schema list",
    category: "discovery",
    description: "List published JSON input schema contracts.",
  },
  {
    command_id: "schema.show",
    command: "schema show",
    category: "discovery",
    description: "Show one published JSON input schema contract by schema id, command id, or command.",
  },
  {
    command_id: "examples.list",
    command: "examples list",
    category: "discovery",
    description: "List available command examples.",
  },
  {
    command_id: "examples.show",
    command: "examples show",
    category: "discovery",
    description: "Show command examples by command id or command.",
  },
  {
    command_id: "risk.evaluate-command",
    command: "risk evaluate-command",
    category: "workflow",
    description: "Evaluate shell command risk using Groundwork risk rules.",
    schemas: ["groundwork.risk.evaluate-command.input/v1"],
  },
  {
    command_id: "risk.evaluate-tool-call",
    command: "risk evaluate-tool-call",
    category: "workflow",
    description:
      "Evaluate a Bash tool call with session-scoped block-once destructive-risk state.",
    schemas: ["groundwork.risk.evaluate-tool-call.input/v1"],
  },
  {
    command_id: "risk.evaluate-tool-result",
    command: "risk evaluate-tool-result",
    category: "workflow",
    description:
      "Report execution after a risky tool call continued past a prior block-once warning.",
    schemas: ["groundwork.risk.evaluate-tool-result.input/v1"],
  },
  {
    command_id: "context.discover",
    command: "context discover",
    category: "workflow",
    description:
      "Discover inherited instruction files for a target path; include root guidance with include_root and omit full text with include_content=false.",
    schemas: ["groundwork.context.discover.input/v1"],
  },
  {
    command_id: "context.touched-paths",
    command: "context touched-paths",
    category: "workflow",
    description: "Discover inherited instruction files for hook-style touched paths with session dedupe; include root guidance with include_root.",
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
    description:
      "Record a one-shot human override for audit and clear the pending override lock; does not create durable scoped approval.",
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
    output_shape: "direct_provenance_state",
    schemas: ["groundwork.provenance.repo-state.input/v1"],
  },
  {
    command_id: "provenance.file-state",
    command: "provenance file-state",
    category: "workflow",
    description: "Inspect one file across local git layers.",
    output_shape: "direct_provenance_state",
    schemas: ["groundwork.provenance.file-state.input/v1"],
  },
  {
    command_id: "provenance.run",
    command: "provenance run",
    category: "workflow",
    description: "Run any registered gw_* provenance tool through the shared local registry.",
    output_shape: "provenance_result",
    schemas: ["groundwork.provenance.run.input/v1"],
  },
  ...DIRECT_PROVENANCE_CLI_COMMAND_NAMES.map((name) => ({
    command_id: `provenance.${name}`,
    command: `provenance ${name}`,
    category: "workflow",
    description: `Run gw_${name.replace(/-/g, "_")} through the shared local provenance registry.`,
    output_shape: "provenance_result",
    schemas: [`groundwork.provenance.${name}.input/v1`],
  })),
  {
    command_id: "session.get",
    command: "session get",
    category: "workflow",
    description: "Read one Groundwork durable session artifact state, or use view=summary for compact counts.",
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
    command_id: "doctor",
    command: "doctor",
    name: "Inspect runtime health",
    args: [],
  },
  {
    command_id: "capabilities",
    command: "capabilities",
    name: "Inspect supported command protocol",
    args: [],
  },
  {
    command_id: "schema.list",
    command: "schema list",
    name: "List input schemas",
    args: [],
  },
  {
    command_id: "schema.show",
    command: "schema show",
    name: "Show one input schema",
    args: ["groundwork.risk.evaluate-command.input/v1"],
  },
  {
    command_id: "examples.list",
    command: "examples list",
    name: "List examples",
    args: [],
  },
  {
    command_id: "examples.show",
    command: "examples show",
    name: "Show examples for one command",
    args: ["risk.evaluate-command"],
  },
  {
    command_id: "risk.evaluate-command",
    command: "risk evaluate-command",
    name: "Block risky git checkout",
    args: [`{"command":"git checkout -- src/index.ts"}`],
  },
  {
    command_id: "risk.evaluate-tool-call",
    command: "risk evaluate-tool-call",
    name: "Block the first exact destructive Bash tool call",
    args: [
      `{"session_id":"example","call_id":"call-1","tool":"bash","command":"git reset --hard","cwd":"."}`,
    ],
  },
  {
    command_id: "risk.evaluate-tool-result",
    command: "risk evaluate-tool-result",
    name: "Report a risky tool call that continued after block-once",
    args: [`{"session_id":"example","call_id":"call-2"}`],
  },
  {
    command_id: "context.discover",
    command: "context discover",
    name: "Find inherited instructions for a file",
    args: [`{"target_path":"src/index.ts","include_root":false}`],
  },
  {
    command_id: "context.discover",
    command: "context discover",
    name: "Find instruction file metadata without full content",
    args: [`{"target_path":"src/index.ts","include_root":true,"include_content":false}`],
  },
  {
    command_id: "context.touched-paths",
    command: "context touched-paths",
    name: "Render new context reminders for touched paths",
    args: [
      `{"session_id":"example","tool":"edit","args":{"path":"src/index.ts"},"include_root":true}`,
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
    command_id: "policy.evaluate-tool-result",
    command: "policy evaluate-tool-result",
    name: "Evaluate a completed tool call against post-tool policy",
    args: [`{"session_id":"example","call_id":"call-1","tool":"edit"}`],
  },
  {
    command_id: "policy.override",
    command: "policy override",
    name: "Clear one pending policy override lock",
    args: [`{"session_id":"example","reason":"Approved by maintainer","rule_id":"strict-skill"}`],
  },
  {
    command_id: "policy.skill-loaded",
    command: "policy skill-loaded",
    name: "Confirm policy skills for a hook session",
    args: [`{"session_id":"example","skills":["release-readiness"]}`],
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
    command_id: "provenance.span-history",
    command: "provenance span-history",
    name: "Inspect lineage for a line span",
    args: [`{"path":"src/index.ts","start_line":1,"end_line":20,"limit":5}`],
  },
  {
    command_id: "provenance.diff-expand",
    command: "provenance diff-expand",
    name: "Expand local diff context for a file",
    args: [`{"path":"src/index.ts","limit":5,"include_patch":false}`],
  },
  {
    command_id: "provenance.commit-materialize",
    command: "provenance commit-materialize",
    name: "Materialize one commit summary",
    args: [`{"commit":"HEAD","limit":10,"include_patch":false}`],
  },
  {
    command_id: "provenance.commit-expand",
    command: "provenance commit-expand",
    name: "Expand one commit with surrounding evidence",
    args: [`{"commit":"HEAD","limit":5,"include_patch":false}`],
  },
  {
    command_id: "provenance.pr-materialize",
    command: "provenance pr-materialize",
    name: "Materialize the current branch as pull-request-like context",
    args: [`{"mode":"local","limit":10}`],
  },
  {
    command_id: "provenance.pr-expand",
    command: "provenance pr-expand",
    name: "Expand the current branch as pull-request-like context",
    args: [`{"mode":"local","limit":5}`],
  },
  {
    command_id: "provenance.tree-expand",
    command: "provenance tree-expand",
    name: "Expand file tree context",
    args: [`{"path":"src","scope":"worktree","max_depth":2,"limit":10}`],
  },
  {
    command_id: "provenance.worktree-overview",
    command: "provenance worktree-overview",
    name: "Summarize worktree changes",
    args: [`{"scope":"worktree","limit":10}`],
  },
  {
    command_id: "provenance.hotspots",
    command: "provenance hotspots",
    name: "Find recent change hotspots",
    args: [`{"path":"src","group_by":"file","limit":10,"max_commits":100}`],
  },
  {
    command_id: "provenance.authority",
    command: "provenance authority",
    name: "Estimate code ownership authority",
    args: [`{"path":"src","window_days":90,"limit":10,"max_commits":100}`],
  },
  {
    command_id: "provenance.stability-report",
    command: "provenance stability-report",
    name: "Compare recent and baseline change stability",
    args: [`{"path":"src","recent_window_days":30,"baseline_window_days":180,"limit":10}`],
  },
  {
    command_id: "provenance.read",
    command: "provenance read",
    name: "Read a file with provenance evidence",
    args: [`{"path":"src/index.ts","max_bytes":4000}`],
  },
  {
    command_id: "provenance.block-read",
    command: "provenance block-read",
    name: "Read a line block with lineage and diff context",
    args: [`{"path":"src/index.ts","start_line":1,"end_line":20,"radius":3,"max_bytes":4000}`],
  },
  {
    command_id: "session.get",
    command: "session get",
    name: "Read one durable session artifact",
    args: [`{"session_id":"example"}`],
  },
  {
    command_id: "session.get",
    command: "session get",
    name: "Read compact durable session summary",
    args: [`{"session_id":"example","view":"summary"}`],
  },
  {
    command_id: "session.skill-loaded",
    command: "session skill-loaded",
    name: "Confirm skills for a hook session",
    args: [`{"session_id":"example","skills":["groundwork"]}`],
  },
  {
    command_id: "session.override",
    command: "session override",
    name: "Record a session override",
    args: [`{"session_id":"example","reason":"Maintainer approved","rule_id":"manual-review"}`],
  },
  {
    command_id: "session.remember-action",
    command: "session remember-action",
    name: "Remember an action dedupe key",
    args: [`{"session_id":"example","key":"call-1","source":"agent","action":"context-reminder"}`],
  },
  {
    command_id: "session.put-pending-tool",
    command: "session put-pending-tool",
    name: "Persist a pending tool snapshot",
    args: [
      `{"session_id":"example","call_id":"call-1","tool_name":"apply_patch","phase":"before","args":{"path":"src/index.ts"}}`,
    ],
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
      data_shapes: {
        direct_provenance_state:
          "Direct provenance state commands place local state DTOs directly in the CLI data field.",
        provenance_result:
          "Registry-backed provenance commands place the nested gw_* provenance result envelope in the CLI data field.",
      },
    },
    commands: COMMAND_CAPABILITIES,
    package_surfaces: {
      cli: "JSON-first commands for policy, context, provenance, risk, and session artifacts.",
      core: "Reusable library package for shared Groundwork foundations.",
      opencode: "OpenCode plugin package that composes the shared foundations into runtime hooks.",
      codex: "Codex plugin package that ships precompiled lifecycle hook commands.",
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
  const byCommandID = new Map<string, typeof EXAMPLES[number][]>();
  for (const entry of EXAMPLES) {
    byCommandID.set(entry.command_id, [...(byCommandID.get(entry.command_id) ?? []), entry]);
  }

  return {
    examples: [...byCommandID.values()].map((entries) => {
      const first = entries[0]!;
      return {
        command_id: first.command_id,
        command: first.command,
        name: first.name,
        example_count: entries.length,
        examples: entries.map((entry) => ({
          name: entry.name,
          args: entry.args,
          ...("stdin" in entry ? { stdin: entry.stdin } : {}),
        })),
      };
    }),
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
