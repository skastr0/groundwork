import path from "node:path";
import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { attachProcessRunner } from "../../shared/effect-runtime.ts";
import { discoverFrameworkContextFiles } from "../context/discovery.ts";
import { evaluateContextTouchedPaths } from "../context/cli-service.ts";
import { evaluateRiskCommand } from "../risk/service.ts";
import {
  acceptPolicyOverride,
  confirmPolicySkillsLoaded,
  evaluatePolicyToolCall,
  evaluatePolicyToolResult,
} from "../policy/cli-service.ts";
import {
  normalizeRequestedPath,
  resolveLocalFileState,
  resolveLocalRepoState,
  toProvFileStateData,
  toProvRepoStateData,
  type Shell,
} from "../provenance/tooling/state/index.ts";
import {
  isProvenanceToolID,
  PROVENANCE_CLI_COMMANDS,
  runProvenanceTool,
} from "../provenance/cli-service.ts";
import {
  COMMAND_CAPABILITIES,
  listExamples,
  listSchemas,
  renderCapabilities,
  renderDoctor,
  showExamples,
  showSchema,
} from "./discovery.ts";
import {
  CodexInstallProjectInputSchema,
  CodexInstallUserInputSchema,
  installCodexProject,
  installCodexUser,
  renderCodexDoctor,
  runCodexHook,
} from "./codex.ts";
import {
  ContextDiscoverInputSchema,
  ContextTouchedPathsInputSchema,
  PolicyEvaluateToolCallInputSchema,
  PolicyEvaluateToolResultInputSchema,
  PolicyOverrideInputSchema,
  PolicySkillLoadedInputSchema,
  ProvenanceFileStateInputSchema,
  ProvenanceRepoStateInputSchema,
  ProvenanceToolArgsInputSchema,
  ProvenanceToolInputSchema,
  RiskEvaluateCommandInputSchema,
} from "./schemas.ts";
import {
  SessionCleanupInputSchema,
  SessionGetInputSchema,
  SessionOverrideInputSchema,
  SessionPutPendingToolInputSchema,
  SessionRememberActionInputSchema,
  SessionRenderCompactionInputSchema,
  SessionSkillLoadedInputSchema,
  cleanupSessionArtifacts,
  getSessionArtifact,
  markSessionSkillsLoaded,
  putPendingSessionTool,
  recordSessionOverride,
  rememberSessionAction,
  renderSessionCompaction,
} from "../session/index.ts";
import { decodeJsonInput, executeJsonCommand } from "./protocol.ts";

const inputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, or - for stdin"),
);

const targetArg = Args.text({ name: "target" }).pipe(
  Args.withDescription("Schema id, command id, or command name"),
);

const COMMAND_DESCRIPTIONS = new Map(
  COMMAND_CAPABILITIES.map((entry) => [entry.command, entry.description] as const),
);

function commandDescription(command: string): string {
  return COMMAND_DESCRIPTIONS.get(command) ?? "";
}

function toEffect(run: () => Promise<void>): Effect.Effect<void> {
  return Effect.promise(run);
}

function resolveRootDir(rootDir: string | undefined): string {
  return path.resolve(rootDir ?? process.cwd());
}

function createShell(rootDir: string): Shell {
  return attachProcessRunner({}, { cwd: rootDir }) as unknown as Shell;
}

const doctorCommand = Command.make("doctor", {}, () =>
  toEffect(() => executeJsonCommand("doctor", async () => renderDoctor())),
).pipe(Command.withDescription("Inspect local runtime health"));

const capabilitiesCommand = Command.make("capabilities", {}, () =>
  toEffect(() => executeJsonCommand("capabilities", async () => renderCapabilities())),
).pipe(Command.withDescription("Describe the Groundwork CLI protocol and command surface"));

const schemaListCommand = Command.make("list", {}, () =>
  toEffect(() => executeJsonCommand("schema list", async () => listSchemas())),
).pipe(Command.withDescription(commandDescription("schema list")));

const schemaShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  toEffect(() => executeJsonCommand("schema show", async () => showSchema(target))),
).pipe(Command.withDescription(commandDescription("schema show")));

const schemaCommand = Command.make("schema").pipe(
  Command.withDescription("Schema discovery commands"),
  Command.withSubcommands([schemaListCommand, schemaShowCommand]),
);

const examplesListCommand = Command.make("list", {}, () =>
  toEffect(() => executeJsonCommand("examples list", async () => listExamples())),
).pipe(Command.withDescription(commandDescription("examples list")));

const examplesShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  toEffect(() => executeJsonCommand("examples show", async () => showExamples(target))),
).pipe(Command.withDescription(commandDescription("examples show")));

const examplesCommand = Command.make("examples").pipe(
  Command.withDescription("Example discovery commands"),
  Command.withSubcommands([examplesListCommand, examplesShowCommand]),
);

const riskEvaluateCommandCommand = Command.make(
  "evaluate-command",
  { input: inputArg },
  ({ input }) =>
    toEffect(() =>
      executeJsonCommand("risk evaluate-command", async () => {
        const payload = await decodeJsonInput(input, RiskEvaluateCommandInputSchema);
        return evaluateRiskCommand({
          command: payload.command,
          config: payload.config,
        });
      }),
    ),
).pipe(Command.withDescription(commandDescription("risk evaluate-command")));

const riskCommand = Command.make("risk").pipe(
  Command.withDescription("Risk guardrail commands"),
  Command.withSubcommands([riskEvaluateCommandCommand]),
);

const contextDiscoverCommand = Command.make("discover", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("context discover", async () => {
      const payload = await decodeJsonInput(input, ContextDiscoverInputSchema);
      const rootDir = resolveRootDir(payload.root_dir);
      const directory = path.resolve(payload.directory ?? process.cwd());
      const files = await discoverFrameworkContextFiles({
        targetPath: payload.target_path,
        directory,
        rootDir,
        includeRoot: payload.include_root,
      });
      return {
        root_dir: rootDir,
        directory,
        target_path: payload.target_path,
        include_root: payload.include_root ?? false,
        include_content: payload.include_content ?? true,
        files:
          payload.include_content === false
            ? files.map((file) => ({
                path: file.path,
                fileName: file.fileName,
                content_bytes: Buffer.byteLength(file.content, "utf8"),
              }))
            : files,
      };
    }),
  ),
).pipe(Command.withDescription(commandDescription("context discover")));

const contextTouchedPathsCommand = Command.make("touched-paths", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("context touched-paths", async () => {
      const payload = await decodeJsonInput(input, ContextTouchedPathsInputSchema);
      return evaluateContextTouchedPaths(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("context touched-paths")));

const contextCommand = Command.make("context").pipe(
  Command.withDescription("Context foundation commands"),
  Command.withSubcommands([contextDiscoverCommand, contextTouchedPathsCommand]),
);

const policyEvaluateToolCallCommand = Command.make(
  "evaluate-tool-call",
  { input: inputArg },
  ({ input }) =>
    toEffect(() =>
      executeJsonCommand("policy evaluate-tool-call", async () => {
        const payload = await decodeJsonInput(input, PolicyEvaluateToolCallInputSchema);
        return evaluatePolicyToolCall(payload);
      }),
    ),
).pipe(Command.withDescription(commandDescription("policy evaluate-tool-call")));

const policyEvaluateToolResultCommand = Command.make(
  "evaluate-tool-result",
  { input: inputArg },
  ({ input }) =>
    toEffect(() =>
      executeJsonCommand("policy evaluate-tool-result", async () => {
        const payload = await decodeJsonInput(input, PolicyEvaluateToolResultInputSchema);
        return evaluatePolicyToolResult(payload);
      }),
    ),
).pipe(Command.withDescription(commandDescription("policy evaluate-tool-result")));

const policyOverrideCommand = Command.make("override", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("policy override", async () => {
      const payload = await decodeJsonInput(input, PolicyOverrideInputSchema);
      return acceptPolicyOverride(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("policy override")));

const policySkillLoadedCommand = Command.make("skill-loaded", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("policy skill-loaded", async () => {
      const payload = await decodeJsonInput(input, PolicySkillLoadedInputSchema);
      return confirmPolicySkillsLoaded(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("policy skill-loaded")));

const policyCommand = Command.make("policy").pipe(
  Command.withDescription("Policy foundation commands"),
  Command.withSubcommands([
    policyEvaluateToolCallCommand,
    policyEvaluateToolResultCommand,
    policyOverrideCommand,
    policySkillLoadedCommand,
  ]),
);

const codexDoctorCommand = Command.make("doctor", {}, () =>
  toEffect(() => executeJsonCommand("codex doctor", async () => renderCodexDoctor())),
).pipe(Command.withDescription(commandDescription("codex doctor")));

const codexInstallProjectCommand = Command.make(
  "install-project",
  { input: inputArg },
  ({ input }) =>
    toEffect(() =>
      executeJsonCommand("codex install-project", async () => {
        const payload = await decodeJsonInput(input, CodexInstallProjectInputSchema);
        return installCodexProject(payload);
      }),
    ),
).pipe(Command.withDescription(commandDescription("codex install-project")));

const codexInstallUserCommand = Command.make("install-user", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("codex install-user", async () => {
      const payload = await decodeJsonInput(input, CodexInstallUserInputSchema);
      return installCodexUser(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("codex install-user")));

const codexHookCommand = Command.make("hook", {}, () => toEffect(() => runCodexHook())).pipe(
  Command.withDescription(commandDescription("codex hook")),
);

const codexCommand = Command.make("codex").pipe(
  Command.withDescription("Codex integration commands"),
  Command.withSubcommands([
    codexDoctorCommand,
    codexHookCommand,
    codexInstallProjectCommand,
    codexInstallUserCommand,
  ]),
);

const provenanceRepoStateCommand = Command.make("repo-state", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("provenance repo-state", async () => {
      const payload = await decodeJsonInput(input, ProvenanceRepoStateInputSchema);
      const rootDir = resolveRootDir(payload.root_dir);
      const state = await resolveLocalRepoState({
        shell: createShell(rootDir),
        explicitBase: payload.base,
      });
      return toProvRepoStateData(state, payload.limit);
    }),
  ),
).pipe(Command.withDescription(commandDescription("provenance repo-state")));

const provenanceFileStateCommand = Command.make("file-state", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("provenance file-state", async () => {
      const payload = await decodeJsonInput(input, ProvenanceFileStateInputSchema);
      const rootDir = resolveRootDir(payload.root_dir);
      const normalizedPath = normalizeRequestedPath(payload.path, rootDir);
      const state = await resolveLocalFileState({
        shell: createShell(rootDir),
        requestedPath: normalizedPath,
        explicitBase: payload.base,
      });
      return toProvFileStateData(state);
    }),
  ),
).pipe(Command.withDescription(commandDescription("provenance file-state")));

const provenanceRunCommand = Command.make("run", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("provenance run", async () => {
      const payload = await decodeJsonInput(input, ProvenanceToolInputSchema);
      return runProvenanceTool(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("provenance run")));

const provenanceRegistryCommands = Object.entries(PROVENANCE_CLI_COMMANDS)
  .filter(([command]) => command !== "repo-state" && command !== "file-state")
  .map(([command, toolID]) =>
    Command.make(command, { input: inputArg }, ({ input }) =>
      toEffect(() =>
        executeJsonCommand(`provenance ${command}`, async () => {
          const payload = await decodeJsonInput(input, ProvenanceToolArgsInputSchema);
          const { root_dir: rootDir, ...args } = payload;
          if (!isProvenanceToolID(toolID)) {
            throw new Error(`Unknown provenance tool '${toolID}'.`);
          }
          return runProvenanceTool({ tool: toolID, root_dir: rootDir, args });
        }),
      ),
    ).pipe(Command.withDescription(commandDescription(`provenance ${command}`))),
  );

const provenanceCommand = Command.make("provenance").pipe(
  Command.withDescription("Provenance foundation commands"),
  Command.withSubcommands([
    provenanceRepoStateCommand,
    provenanceFileStateCommand,
    provenanceRunCommand,
    ...provenanceRegistryCommands,
  ]),
);

const sessionGetCommand = Command.make("get", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("session get", async () => {
      const payload = await decodeJsonInput(input, SessionGetInputSchema);
      return getSessionArtifact(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("session get")));

const sessionSkillLoadedCommand = Command.make("skill-loaded", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("session skill-loaded", async () => {
      const payload = await decodeJsonInput(input, SessionSkillLoadedInputSchema);
      return markSessionSkillsLoaded(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("session skill-loaded")));

const sessionOverrideCommand = Command.make("override", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("session override", async () => {
      const payload = await decodeJsonInput(input, SessionOverrideInputSchema);
      return recordSessionOverride(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("session override")));

const sessionRememberActionCommand = Command.make(
  "remember-action",
  { input: inputArg },
  ({ input }) =>
    toEffect(() =>
      executeJsonCommand("session remember-action", async () => {
        const payload = await decodeJsonInput(input, SessionRememberActionInputSchema);
        return rememberSessionAction(payload);
      }),
    ),
).pipe(Command.withDescription(commandDescription("session remember-action")));

const sessionPutPendingToolCommand = Command.make(
  "put-pending-tool",
  { input: inputArg },
  ({ input }) =>
    toEffect(() =>
      executeJsonCommand("session put-pending-tool", async () => {
        const payload = await decodeJsonInput(input, SessionPutPendingToolInputSchema);
        return putPendingSessionTool(payload);
      }),
    ),
).pipe(Command.withDescription(commandDescription("session put-pending-tool")));

const sessionCleanupCommand = Command.make("cleanup", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("session cleanup", async () => {
      const payload = await decodeJsonInput(input, SessionCleanupInputSchema);
      return cleanupSessionArtifacts(payload);
    }),
  ),
).pipe(Command.withDescription(commandDescription("session cleanup")));

const sessionRenderCompactionCommand = Command.make(
  "render-compaction",
  { input: inputArg },
  ({ input }) =>
    toEffect(() =>
      executeJsonCommand("session render-compaction", async () => {
        const payload = await decodeJsonInput(input, SessionRenderCompactionInputSchema);
        return renderSessionCompaction(payload);
      }),
    ),
).pipe(Command.withDescription(commandDescription("session render-compaction")));

const sessionCommand = Command.make("session").pipe(
  Command.withDescription("Session artifact commands"),
  Command.withSubcommands([
    sessionCleanupCommand,
    sessionGetCommand,
    sessionOverrideCommand,
    sessionPutPendingToolCommand,
    sessionRememberActionCommand,
    sessionRenderCompactionCommand,
    sessionSkillLoadedCommand,
  ]),
);

export const rootCommand = Command.make("groundwork").pipe(
  Command.withDescription(
    "JSON-first Groundwork CLI for agent guardrails and evidence. Run `groundwork capabilities`, `groundwork schema show <command>`, and `groundwork examples show <command>` for machine-readable contracts and examples.",
  ),
  Command.withSubcommands([
    capabilitiesCommand,
    codexCommand,
    contextCommand,
    doctorCommand,
    examplesCommand,
    policyCommand,
    provenanceCommand,
    riskCommand,
    schemaCommand,
    sessionCommand,
  ]),
);
