import {
  DEFAULT_GUARD_CONFIG,
  evaluateBashCommand,
  type GuardConfig,
  type GuardViolation,
} from "./rules.ts";

export interface RiskCommandEvaluation {
  decision: "allow" | "warn" | "block";
  violation: GuardViolation | null;
  config: GuardConfig;
}

export function evaluateRiskCommand(params: {
  command: string;
  config?: Partial<GuardConfig>;
}): RiskCommandEvaluation {
  const config: GuardConfig = {
    ...DEFAULT_GUARD_CONFIG,
    ...params.config,
  };
  if (config.mode === "off") {
    return {
      decision: "allow",
      violation: null,
      config,
    };
  }

  const decision = evaluateBashCommand(params.command, config);
  return {
    decision: decision.violation ? config.mode : "allow",
    violation: decision.violation,
    config,
  };
}

export function riskViolationMessage(violation: GuardViolation): string {
  return `[groundwork:risk] ${violation.reason} (rule: ${violation.ruleId})`;
}
