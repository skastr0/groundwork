import { pathToFileURL } from "node:url";

const hookFile = process.argv[2];

function writeHookJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

try {
  if (!hookFile) {
    throw new Error("missing bundled hook file path");
  }

  const hook = await import(pathToFileURL(hookFile).href);
  await hook.runCodexHook();
} catch (error) {
  writeHookJson({
    systemMessage: `[groundwork] Codex hook failed: ${errorMessage(error)}`,
  });
  process.exitCode = 1;
}
