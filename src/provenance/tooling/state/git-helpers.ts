import {
  runOptionalProcessText,
  type ProcessCommand,
} from "../../../../shared/effect-runtime.ts";
import type { Shell } from "./types.ts";

export async function readTextOrEmpty(
  shell: Shell,
  cmd: ProcessCommand,
  options: { trim?: boolean } = {},
): Promise<string> {
  return runOptionalProcessText({
    shell,
    cmd,
    trim: options.trim,
  });
}

export async function refExists(shell: Shell, ref: string): Promise<boolean> {
  const value = await readTextOrEmpty(shell, ["git", "rev-parse", "--verify", ref]);
  return value.length > 0;
}
