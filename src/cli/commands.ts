import path from "node:path";
import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { attachProcessRunner } from "../../shared/effect-runtime.ts";
import { discoverFrameworkContextFiles } from "../context/discovery.ts";
import {
  evaluateBashCommand,
  DEFAULT_GUARD_CONFIG,
  type GuardConfig,
} from "../risk/rules.ts";
import {
  resolveLocalFileState,
  resolveLocalRepoState,
  type Shell,
  type LocalFileState,
  type LocalRepoState,
} from "../provenance/tooling/state/local-state.ts";
import {
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
  ProvenanceFileStateInputSchema,
  ProvenanceRepoStateInputSchema,
  RiskEvaluateCommandInputSchema,
} from "./schemas.ts";
import { decodeJsonInput, executeJsonCommand } from "./protocol.ts";

const inputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, or - for stdin"),
);

const targetArg = Args.text({ name: "target" }).pipe(
  Args.withDescription("Schema id, command id, or command name"),
);

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
);

const schemaShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  toEffect(() => executeJsonCommand("schema show", async () => showSchema(target))),
);

const schemaCommand = Command.make("schema").pipe(
  Command.withDescription("Schema discovery commands"),
  Command.withSubcommands([schemaListCommand, schemaShowCommand]),
);

const examplesListCommand = Command.make("list", {}, () =>
  toEffect(() => executeJsonCommand("examples list", async () => listExamples())),
);

const examplesShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  toEffect(() => executeJsonCommand("examples show", async () => showExamples(target))),
);

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
        const config: GuardConfig = {
          ...DEFAULT_GUARD_CONFIG,
          ...payload.config,
        };
        const decision = evaluateBashCommand(payload.command, config);
        return {
          decision: decision.violation ? "block" : "allow",
          violation: decision.violation,
          config,
        };
      }),
    ),
);

const riskCommand = Command.make("risk").pipe(
  Command.withDescription("Risk guardrail commands"),
  Command.withSubcommands([riskEvaluateCommandCommand]),
);

const contextDiscoverCommand = Command.make("discover", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("context discover", async () => {
      const payload = await decodeJsonInput(input, ContextDiscoverInputSchema);
      const directory = path.resolve(payload.directory ?? process.cwd());
      const rootDir = resolveRootDir(payload.root_dir);
      const files = await discoverFrameworkContextFiles({
        targetPath: payload.target_path,
        directory,
        rootDir,
      });
      return {
        root_dir: rootDir,
        directory,
        target_path: payload.target_path,
        files,
      };
    }),
  ),
);

const contextCommand = Command.make("context").pipe(
  Command.withDescription("Context foundation commands"),
  Command.withSubcommands([contextDiscoverCommand]),
);

const codexDoctorCommand = Command.make("doctor", {}, () =>
  toEffect(() => executeJsonCommand("codex doctor", async () => renderCodexDoctor())),
);

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
);

const codexInstallUserCommand = Command.make("install-user", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("codex install-user", async () => {
      const payload = await decodeJsonInput(input, CodexInstallUserInputSchema);
      return installCodexUser(payload);
    }),
  ),
);

const codexHookCommand = Command.make("hook", {}, () => toEffect(() => runCodexHook()));

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
      return toRepoStateData(state, payload.limit);
    }),
  ),
);

const provenanceFileStateCommand = Command.make("file-state", { input: inputArg }, ({ input }) =>
  toEffect(() =>
    executeJsonCommand("provenance file-state", async () => {
      const payload = await decodeJsonInput(input, ProvenanceFileStateInputSchema);
      const rootDir = resolveRootDir(payload.root_dir);
      const state = await resolveLocalFileState({
        shell: createShell(rootDir),
        requestedPath: payload.path,
        explicitBase: payload.base,
      });
      return toFileStateData(state);
    }),
  ),
);

const provenanceCommand = Command.make("provenance").pipe(
  Command.withDescription("Provenance foundation commands"),
  Command.withSubcommands([provenanceRepoStateCommand, provenanceFileStateCommand]),
);

export const rootCommand = Command.make("groundwork").pipe(
  Command.withDescription("JSON-first Groundwork CLI for agent guardrails and evidence"),
  Command.withSubcommands([
    capabilitiesCommand,
    codexCommand,
    contextCommand,
    doctorCommand,
    examplesCommand,
    provenanceCommand,
    riskCommand,
    schemaCommand,
  ]),
);

function getBoundedItems<T>(
  items: readonly T[],
  limit: number | undefined,
): { items: T[]; truncated: boolean } {
  const resolvedLimit = limit ?? 20;
  return {
    items: [...items.slice(0, resolvedLimit)],
    truncated: items.length > resolvedLimit,
  };
}

function toRepoStateData(state: LocalRepoState, limit: number | undefined) {
  const staged = getBoundedItems(state.index.files, limit);
  const unstaged = getBoundedItems(state.worktree.files, limit);
  const untracked = getBoundedItems(state.untracked.files, limit);

  return {
    branch: state.currentBranch,
    base: {
      ref: state.base.ref,
      branchName: state.base.branchName,
      detectionKind: state.base.detection.kind,
      explicit: state.base.detection.explicit,
      confidence: state.base.confidence,
      detectionMethod: state.base.detectionMethod,
    },
    head: state.head,
    staged: {
      ...state.index,
      truncated: staged.truncated,
      files: staged.items,
    },
    unstaged: {
      ...state.worktree,
      truncated: unstaged.truncated,
      files: unstaged.items,
    },
    untracked: {
      ...state.untracked,
      truncated: untracked.truncated,
      files: untracked.items,
    },
    ambiguity: state.ambiguity,
  };
}

function toFileStateData(state: LocalFileState) {
  return {
    requestedPath: state.requestedPath,
    resolvedPath: state.resolvedPath,
    base: state.base,
    head: {
      ...state.head,
      ref: "HEAD",
    },
    index: {
      ...state.index,
      ref: "index",
    },
    worktree: {
      ...state.worktree,
      ref: "worktree",
    },
    comparisons: {
      baseToHead: {
        ...state.comparisons.baseToHead,
        toRef: "HEAD",
      },
      headToIndex: {
        ...state.comparisons.headToIndex,
        fromRef: "HEAD",
        toRef: "index",
      },
      indexToWorktree: {
        ...state.comparisons.indexToWorktree,
        fromRef: "index",
        toRef: "worktree",
      },
    },
    ambiguity: state.ambiguity,
  };
}
