export { normalizePathForMatching } from "./paths.ts";
export {
  filterPathsByRuleContent,
  resolveRuleScope,
  ruleContentMatcherType,
  runAstGrepMatcher,
  runContentMatcher,
  runSemgrepMatcher,
} from "./content/index.ts";

export type {
  AstGrepContentMatcher,
  AstGrepStrictness,
  ContentMatchRunner,
  GuardrailAction,
  GuardrailChangeTarget,
  GuardrailContentMatcher,
  GuardrailContentScope,
  GuardrailMatcherExpectation,
  GuardrailPolicyConfig,
  GuardrailRule,
  GuardrailSeverity,
  GuardrailSkillEnforcementMode,
  LineRange,
  SemgrepContentMatcher,
  SemgrepSeverity,
} from "./config-types.ts";
export { DEFAULT_EDIT_FOCUSED_TOOLS } from "./config-types.ts";

export {
  resolveGlobalPolicyConfigPath,
  resolveGlobalPolicyConfigPaths,
  resolvePolicyConfigPath,
  resolveProjectPolicyConfigPath,
  resolveProjectPolicyConfigPaths,
} from "./config-paths.ts";
export {
  loadMergedPolicyConfig,
  loadPolicyConfig,
  mergePolicyConfigs,
} from "./config-loader.ts";
export { parsePolicyConfig } from "./config-parser.ts";
export {
  extractCandidatePaths,
  extractChangeTargets,
} from "./config-targets.ts";
export {
  findMatchingRules,
  ruleMatchesPath,
  ruleMatchesTool,
} from "./config-matching.ts";
