import { configFromEnv, type GuardConfig } from "./rules.ts";
import { evaluateRiskCommand, riskViolationMessage } from "./service.ts";
import {
  FrameworkEnforcementError,
  type GroundworkLayerHooks,
  type GroundworkLayerRegistration,
} from "../layer/dispatcher.ts";
import { logFrameworkEvent } from "../logger/events.ts";
import type { FrameworkLogClient } from "../logger/index.ts";

const SERVICE = "groundwork-risk";

type FrameworkRiskClient = FrameworkLogClient;

type RiskToolBeforeHook = NonNullable<
  GroundworkLayerHooks["tool.execute.before"]
>;

export interface CreateFrameworkRiskLayerOptions {
  client: FrameworkRiskClient;
  env?: NodeJS.ProcessEnv;
}

export async function createFrameworkRiskLayer(
  options: CreateFrameworkRiskLayerOptions,
): Promise<GroundworkLayerRegistration> {
  const config = configFromEnv(options.env);

  await logFrameworkEvent(options.client, SERVICE, "info", "Plugin initialized", {
    mode: config.mode,
    includeExtendedRules: config.includeExtendedRules,
    allowTempRecursiveForceRm: config.allowTempRecursiveForceRm,
  });

  return {
    active: true,
    hooks: {
      "tool.execute.before": createRiskToolBeforeHook({
        client: options.client,
        config,
      }),
    },
  };
}

export function createRiskToolBeforeHook(params: {
  client: FrameworkRiskClient;
  config: GuardConfig;
}): RiskToolBeforeHook {
  const { client, config } = params;

  return async ({ tool, callID, sessionID }, { args }) => {
    if (tool !== "bash") return;
    if (config.mode === "off") return;

    const command = extractCommand(args);
    if (!command) return;

    const decision = evaluateRiskCommand({ command, config });
    if (!decision.violation) return;

    await logFrameworkEvent(client, SERVICE, "warn", "Blocked potentially destructive command", {
      mode: config.mode,
      callID,
      sessionID,
      ruleId: decision.violation.ruleId,
      severity: decision.violation.severity,
      command: truncateCommand(command),
    });

    if (decision.decision === "warn") return;

    throw new FrameworkEnforcementError({
      message: riskViolationMessage(decision.violation),
      source: SERVICE,
      code: decision.violation.ruleId,
    });
  };
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
