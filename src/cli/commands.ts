import path from "node:path";
import { Args, Command } from "@effect/cli";
import { Effect, Either } from "effect";
import type { ZodType } from "zod";
import {
  PROVENANCE_CLI_COMMANDS,
  SessionCleanupInputSchema,
  SessionGetInputSchema,
  SessionOverrideInputSchema,
  SessionPutPendingToolInputSchema,
  SessionRememberActionInputSchema,
  SessionRenderCompactionInputSchema,
  SessionSkillLoadedInputSchema,
  acceptPolicyOverride,
  attachProcessRunner,
  cleanupSessionArtifacts,
  confirmPolicySkillsLoadedEffect,
  discoverFrameworkContextFiles,
  evaluateContextTouchedPaths,
  evaluatePolicyToolCall,
  evaluatePolicyToolResult,
  evaluateRiskCommand,
  getSessionArtifact,
  isProvenanceToolID,
  markSessionSkillsLoaded,
  normalizeRequestedPath,
  putPendingSessionTool,
  recordSessionOverride,
  rememberSessionAction,
  renderSessionCompaction,
  resolveLocalFileState,
  resolveLocalRepoState,
  runProvenanceTool,
  toProvFileStateData,
  toProvRepoStateData,
  type Shell,
} from "@skastr0/groundwork-core/cli-support";
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
import { decodeJsonInputEffect, executeJsonCommand } from "./protocol.ts";

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
function jsonEffect(command: string, run: () => unknown | Promise<unknown>): Effect.Effect<void> {
  return toEffect(() => executeJsonCommand(command, async () => run()));
}
function decodedJsonEffect<T>(
  command: string,
  input: string,
  schema: ZodType<T>,
  run: (payload: T) => unknown | Promise<unknown>,
): Effect.Effect<void> {
  return jsonEffect(command, async () => run(await decodeInput(input, schema)));
}
async function decodeInput<T>(input: string, schema: ZodType<T>): Promise<T> {
  const decoded = await Effect.runPromise(Effect.either(decodeJsonInputEffect(input, schema)));
  if (Either.isRight(decoded)) {
    return decoded.right;
  }

  throw decoded.left;
}

function resolveRootDir(rootDir: string | undefined): string {
  return path.resolve(rootDir ?? process.cwd());
}

function createShell(rootDir: string): Shell {
  return attachProcessRunner({}, { cwd: rootDir }) as unknown as Shell;
}

const doctorCommand = Command.make("doctor", {}, () =>
  jsonEffect("doctor", () => renderDoctor()),
).pipe(Command.withDescription("Inspect local runtime health"));

const capabilitiesCommand = Command.make("capabilities", {}, () =>
  jsonEffect("capabilities", () => renderCapabilities()),
).pipe(Command.withDescription("Describe the Groundwork CLI protocol and command surface"));

const schemaListCommand = Command.make("list", {}, () =>
  jsonEffect("schema list", () => listSchemas()),
).pipe(Command.withDescription(commandDescription("schema list")));

const schemaShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  jsonEffect("schema show", () => showSchema(target)),
).pipe(Command.withDescription(commandDescription("schema show")));

const schemaCommand = Command.make("schema").pipe(
  Command.withDescription("Schema discovery commands"),
  Command.withSubcommands([schemaListCommand, schemaShowCommand]),
);

const examplesListCommand = Command.make("list", {}, () =>
  jsonEffect("examples list", () => listExamples()),
).pipe(Command.withDescription(commandDescription("examples list")));

const examplesShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  jsonEffect("examples show", () => showExamples(target)),
).pipe(Command.withDescription(commandDescription("examples show")));

const examplesCommand = Command.make("examples").pipe(
  Command.withDescription("Example discovery commands"),
  Command.withSubcommands([examplesListCommand, examplesShowCommand]),
);

const riskEvaluateCommandCommand = Command.make(
  "evaluate-command",
  { input: inputArg },
  ({ input }) =>
    decodedJsonEffect("risk evaluate-command", input, RiskEvaluateCommandInputSchema, (payload) =>
      evaluateRiskCommand({
        command: payload.command,
        config: payload.config,
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
      const payload = await decodeInput(input, ContextDiscoverInputSchema);
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
  decodedJsonEffect("context touched-paths", input, ContextTouchedPathsInputSchema, (payload) =>
    evaluateContextTouchedPaths(payload),
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
    decodedJsonEffect(
      "policy evaluate-tool-call",
      input,
      PolicyEvaluateToolCallInputSchema,
      (payload) => evaluatePolicyToolCall(payload),
    ),
).pipe(Command.withDescription(commandDescription("policy evaluate-tool-call")));

const policyEvaluateToolResultCommand = Command.make(
  "evaluate-tool-result",
  { input: inputArg },
  ({ input }) =>
    decodedJsonEffect(
      "policy evaluate-tool-result",
      input,
      PolicyEvaluateToolResultInputSchema,
      (payload) => evaluatePolicyToolResult(payload),
    ),
).pipe(Command.withDescription(commandDescription("policy evaluate-tool-result")));

const policyOverrideCommand = Command.make("override", { input: inputArg }, ({ input }) =>
  decodedJsonEffect("policy override", input, PolicyOverrideInputSchema, (payload) =>
    acceptPolicyOverride(payload),
  ),
).pipe(Command.withDescription(commandDescription("policy override")));

const policySkillLoadedCommand = Command.make("skill-loaded", { input: inputArg }, ({ input }) =>
  decodedJsonEffect("policy skill-loaded", input, PolicySkillLoadedInputSchema, (payload) =>
    Effect.runPromise(confirmPolicySkillsLoadedEffect(payload)),
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

const provenanceRepoStateCommand = Command.make("repo-state", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("provenance repo-state", async () => {
      const payload = await decodeInput(input, ProvenanceRepoStateInputSchema);
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
      const payload = await decodeInput(input, ProvenanceFileStateInputSchema);
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
  decodedJsonEffect("provenance run", input, ProvenanceToolInputSchema, (payload) =>
    runProvenanceTool(payload),
  ),
).pipe(Command.withDescription(commandDescription("provenance run")));

const provenanceRegistryCommands = Object.entries(PROVENANCE_CLI_COMMANDS)
  .filter(([command]) => command !== "repo-state" && command !== "file-state")
  .map(([command, toolID]) =>
    Command.make(command, { input: inputArg }, ({ input }) =>
      toEffect(() =>
        executeJsonCommand(`provenance ${command}`, async () => {
          const payload = await decodeInput(input, ProvenanceToolArgsInputSchema);
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
  decodedJsonEffect("session get", input, SessionGetInputSchema, (payload) =>
    getSessionArtifact(payload),
  ),
).pipe(Command.withDescription(commandDescription("session get")));

const sessionSkillLoadedCommand = Command.make("skill-loaded", { input: inputArg }, ({ input }) =>
  decodedJsonEffect("session skill-loaded", input, SessionSkillLoadedInputSchema, (payload) =>
    markSessionSkillsLoaded(payload),
  ),
).pipe(Command.withDescription(commandDescription("session skill-loaded")));

const sessionOverrideCommand = Command.make("override", { input: inputArg }, ({ input }) =>
  decodedJsonEffect("session override", input, SessionOverrideInputSchema, (payload) =>
    recordSessionOverride(payload),
  ),
).pipe(Command.withDescription(commandDescription("session override")));

const sessionRememberActionCommand = Command.make(
  "remember-action",
  { input: inputArg },
  ({ input }) =>
    decodedJsonEffect(
      "session remember-action",
      input,
      SessionRememberActionInputSchema,
      (payload) => rememberSessionAction(payload),
    ),
).pipe(Command.withDescription(commandDescription("session remember-action")));

const sessionPutPendingToolCommand = Command.make(
  "put-pending-tool",
  { input: inputArg },
  ({ input }) =>
    decodedJsonEffect(
      "session put-pending-tool",
      input,
      SessionPutPendingToolInputSchema,
      (payload) => putPendingSessionTool(payload),
    ),
).pipe(Command.withDescription(commandDescription("session put-pending-tool")));

const sessionCleanupCommand = Command.make("cleanup", { input: inputArg }, ({ input }) =>
  decodedJsonEffect("session cleanup", input, SessionCleanupInputSchema, (payload) =>
    cleanupSessionArtifacts(payload),
  ),
).pipe(Command.withDescription(commandDescription("session cleanup")));

const sessionRenderCompactionCommand = Command.make(
  "render-compaction",
  { input: inputArg },
  ({ input }) =>
    decodedJsonEffect(
      "session render-compaction",
      input,
      SessionRenderCompactionInputSchema,
      (payload) => renderSessionCompaction(payload),
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
