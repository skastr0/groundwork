import path from "node:path";
import { attachProcessRunner } from "../../../../shared/effect-runtime.ts";
import type { Shell } from "./local-state.ts";

export interface CreateStateToolsOptions {
  shell: Shell;
  rootDir?: string;
}

export function normalizeCreateStateToolsOptions(
  options: CreateStateToolsOptions,
): CreateStateToolsOptions {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : undefined;

  return {
    rootDir,
    shell: attachProcessRunner(options.shell, { cwd: rootDir }),
  };
}
