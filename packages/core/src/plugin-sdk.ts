/**
 * Surface for harness plugins: portable hook decisions + provenance runners.
 * CLI and plugins both depend on this; plugins prebundle it so harnesses need no CLI.
 */
export {
  normalizePolicyToolName,
  parsePolicyPromptCommands,
  permissionRequestResult,
  promptSubmitResult,
  sessionStartResult,
  toolAfterResult,
  toolBeforeResult,
  type PortableBlock,
  type PortableContinue,
  type PortableHookResult,
  type PortablePermissionRequestInput,
  type PortablePromptSubmitInput,
  type PortableSessionStartInput,
  type PortableToolAfterInput,
  type PortableToolBeforeInput,
} from "./portable/index.ts";

export {
  FRAMEWORK_PROVENANCE_TOOL_IDS,
  isProvenanceToolID,
  PROVENANCE_CLI_COMMANDS,
  runProvenanceTool,
  type FrameworkProvenanceToolID,
} from "./provenance/cli-service.ts";
