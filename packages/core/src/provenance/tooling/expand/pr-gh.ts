import { runProcessText } from "../../../shared/effect-runtime.ts";
import type { CreateStateToolsOptions } from "../state/internal.ts";
import { logger } from "../utils/logger.ts";
import {
  GH_COMMAND_TIMEOUT_MS,
  PR_REMOTE_PARSE_MAX_OUTPUT_BYTES,
  type GhFailure,
  type GhResult,
  type PrToolName,
} from "./pr-types.ts";
import { toErrorMessage } from "./shared.ts";

export function classifyGhFailure(message: string): GhFailure {
  if (
    /gh auth login|not logged into any github hosts|authentication failed|authentication required|set the gh_token|set the github_token/i.test(
      message,
    )
  ) {
    return {
      code: "GH_UNAUTHENTICATED",
      message: `GitHub CLI authentication is unavailable: ${message}`,
      retryable: true,
      confidence: "unknown",
    };
  }

  if (
    /no pull requests found|could not resolve to a pullrequest|pull request not found|no pull request found/i.test(
      message,
    )
  ) {
    return {
      code: "PR_NOT_FOUND",
      message: `Remote PR context is unavailable: ${message}`,
      retryable: false,
      confidence: "low",
    };
  }

  if (/enoent|command not found|no such file or directory/i.test(message)) {
    return {
      code: "GH_UNAVAILABLE",
      message: `GitHub CLI is unavailable: ${message}`,
      retryable: true,
      confidence: "unknown",
    };
  }

  return {
    code: "GH_REMOTE_ERROR",
    message: `GitHub CLI request failed: ${message}`,
    retryable: true,
    confidence: "unknown",
  };
}

export async function runGhText(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  command: string;
  cmd: readonly [string, ...string[]];
}): Promise<GhResult<string>> {
  logger.debug("pr gh command start", {
    tool: options.toolName,
    command: options.command,
  });

  try {
    const data = await runProcessText({
      shell: options.shell,
      cmd: options.cmd,
      timeoutMs: GH_COMMAND_TIMEOUT_MS,
      maxOutputBytes: PR_REMOTE_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    });
    return { success: true, data };
  } catch (error) {
    const failure = classifyGhFailure(toErrorMessage(error));
    logger.warn("pr gh command failed", {
      tool: options.toolName,
      command: options.command,
      code: failure.code,
      error: failure.message,
    });
    return { success: false, failure };
  }
}

export function parseJsonResult<T>(raw: string, context: string): GhResult<T> {
  try {
    return {
      success: true,
      data: JSON.parse(raw) as T,
    };
  } catch (error) {
    return {
      success: false,
      failure: {
        code: "GH_INVALID_JSON",
        message: `GitHub CLI returned invalid JSON for ${context}: ${toErrorMessage(error)}`,
        retryable: true,
        confidence: "unknown",
      },
    };
  }
}
