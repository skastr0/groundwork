import type {
  FrameworkPromptContextClient,
} from "../kernel/prompt-context.ts";
import type {
  FrameworkSessionKernelState,
  SessionKernelStore,
} from "../kernel/state.ts";
import type { FrameworkLogClient } from "../logger/index.ts";
import {
  DEFAULT_EDIT_FOCUSED_TOOLS,
  type GuardrailAction,
  type GuardrailChangeTarget,
  type GuardrailPolicyConfig,
  type GuardrailSeverity,
} from "./config.ts";
import type { EvaluationPhase } from "./evaluation.ts";

export const SERVICE = "groundwork-policy";
export const MUTATING_TOOLS = new Set<string>(DEFAULT_EDIT_FOCUSED_TOOLS);
export const POLICY_RUNTIME_METADATA_KEY = "policyRuntime";
export const POLICY_CONTENT_MATCH_CACHE_BUCKET = "policy-content-matches";
export const POLICY_PENDING_OVERRIDE_LOCK_KEY = "policy-pending-override";
export const POLICY_TERMINATION_LOCK_KEY = "policy-terminated";
export const SEVERITY_ORDER: Record<GuardrailSeverity, number> = {
  advisory: 0,
  warn: 1,
  block: 2,
  terminate: 3,
};

export type ParsedPolicyCommand =
  | {
      type: "override";
      reason: string;
    }
  | {
      type: "skill_loaded";
      skills: string[];
    };

export type PolicyRuntimeState = {
  completedInjectOnlyRules: Set<string>;
  confirmedSkills: Set<string>;
  promptContextLoaded: boolean;
};

export type PolicyHumanOverrideLock = {
  ruleId: string;
  message: string;
  paths: string[];
  createdAt: string;
};

export type PolicySessionTermination = {
  ruleId: string;
  message: string;
  paths: string[];
  createdAt: string;
};

export interface PolicyActionRuleRef {
  id: string;
}

export type FrameworkPolicyRuntimeClient =
  FrameworkLogClient & FrameworkPromptContextClient;

export interface CreateFrameworkPolicyLayerOptions {
  client: FrameworkPolicyRuntimeClient;
  directory: string;
  ownSessionCleanup?: boolean;
  sessionStore?: SessionKernelStore;
  worktree?: string;
  env?: NodeJS.ProcessEnv;
}

export type PolicyLayerRuntime = {
  client: FrameworkPolicyRuntimeClient;
  directory: string;
  ownSessionCleanup: boolean;
  rootDir: string;
  config: GuardrailPolicyConfig | null | undefined;
  sessionStore: SessionKernelStore;
};

export type ExecuteActionParams<TAction extends GuardrailAction = GuardrailAction> = {
  action: TAction;
  actionIndex: number;
  phase: EvaluationPhase;
  tool: string;
  callID: string;
  sessionID: string;
  rule: PolicyActionRuleRef;
  ruleSeverity: GuardrailSeverity;
  normalizedPaths: string[];
  rootDir: string;
  client: FrameworkPolicyRuntimeClient;
  sessionStore: SessionKernelStore;
  state: FrameworkSessionKernelState;
  runtimeState: PolicyRuntimeState;
};

export type PolicyActionOf<TType extends GuardrailAction["type"]> = Extract<
  GuardrailAction,
  { type: TType }
>;
