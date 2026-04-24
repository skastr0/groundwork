import type { PluginInput } from "@opencode-ai/plugin";
import { configFromEnv, evaluateBashCommand, type GuardConfig } from "./rules.ts";
import {
  FrameworkEnforcementError,
  type EpistemologyFrameworkLayerHooks,
  type EpistemologyFrameworkLayerRegistration,
} from "../layer/index.ts";

const SERVICE = "epistemology-framework-mutation-risk";

interface FrameworkMutationRiskClient {
  app: PluginInput["client"]["app"];
}

type MutationRiskToolBeforeHook = NonNullable<
  EpistemologyFrameworkLayerHooks["tool.execute.before"]
>;

export interface CreateFrameworkMutationRiskLayerOptions {
  client: FrameworkMutationRiskClient;
  env?: NodeJS.ProcessEnv;
}

export async function createFrameworkMutationRiskLayer(
  options: CreateFrameworkMutationRiskLayerOptions,
): Promise<EpistemologyFrameworkLayerRegistration> {
  const config = configFromEnv(options.env);

  await log(options.client, "info", "Plugin initialized", {
    mode: config.mode,
    includeExtendedRules: config.includeExtendedRules,
    allowTempRecursiveForceRm: config.allowTempRecursiveForceRm,
  });

  return {
    active: true,
    hooks: {
      "tool.execute.before": createMutationRiskToolBeforeHook({
        client: options.client,
        config,
      }),
    },
  };
}

export function createMutationRiskToolBeforeHook(params: {
  client: FrameworkMutationRiskClient;
  config: GuardConfig;
}): MutationRiskToolBeforeHook {
  const { client, config } = params;

  return async ({ tool, callID, sessionID }, { args }) => {
    if (tool !== "bash") return;
    if (config.mode === "off") return;

    const command = extractCommand(args);
    if (!command) return;

    const decision = evaluateBashCommand(command, config);
    if (!decision.violation) return;

    await log(client, "warn", "Blocked potentially destructive command", {
      mode: config.mode,
      callID,
      sessionID,
      ruleId: decision.violation.ruleId,
      severity: decision.violation.severity,
      command: truncateCommand(command),
    });

    if (config.mode === "warn") return;

    throw new FrameworkEnforcementError({
      message: `[epistemology-framework:mutation-risk] ${decision.violation.reason} (rule: ${decision.violation.ruleId})`,
      source: SERVICE,
      code: decision.violation.ruleId,
    });
  };
}

async function log(
  client: FrameworkMutationRiskClient,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: SERVICE,
        level,
        message,
        extra,
      },
    });
  } catch {
    // ignore logging failures
  }
}

function extractCommand(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const maybeCommand = (args as { command?: unknown }).command;
  return typeof maybeCommand === "string" ? maybeCommand : null;
}

function truncateCommand(command: string): string {
  const maxLength = 320;
  if (command.length <= maxLength) return command;
  return `${command.slice(0, maxLength)}...`;
}
