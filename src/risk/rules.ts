import { splitCommandSegments } from "./command-segments.ts";

export type GuardMode = "block" | "warn" | "off";

export type GuardConfig = {
  mode: GuardMode;
  includeExtendedRules: boolean;
  allowTempRecursiveForceRm: boolean;
};

export type GuardSeverity = "high" | "critical";

export type GuardViolation = {
  ruleId: string;
  severity: GuardSeverity;
  reason: string;
  segment: string;
};

export type GuardDecision = {
  violation: GuardViolation | null;
};

const DEFAULT_MODE: GuardMode = "block";
const MAX_INLINE_DEPTH = 2;

const TEMP_PREFIXES = ["/tmp", "/var/tmp"];

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  mode: DEFAULT_MODE,
  includeExtendedRules: true,
  allowTempRecursiveForceRm: true,
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  return {
    mode: parseMode(env.GROUNDWORK_DESTRUCTIVE_GUARD_MODE),
    includeExtendedRules: parseBoolean(env.GROUNDWORK_DESTRUCTIVE_GUARD_EXTENDED, true),
    allowTempRecursiveForceRm: parseBoolean(env.GROUNDWORK_DESTRUCTIVE_GUARD_ALLOW_TMP_RM_RF, true),
  };
}

export function evaluateBashCommand(
  rawCommand: string,
  config: GuardConfig = DEFAULT_GUARD_CONFIG,
): GuardDecision {
  return evaluateBashCommandInternal(rawCommand, config, 0);
}

function evaluateBashCommandInternal(
  rawCommand: string,
  config: GuardConfig,
  depth: number,
): GuardDecision {
  const segments = splitCommandSegments(rawCommand);

  for (const segment of segments) {
    const violation = evaluateSegment(segment, config, depth);
    if (violation) {
      return { violation };
    }
  }

  return { violation: null };
}

function evaluateSegment(
  segment: string,
  config: GuardConfig,
  depth: number,
): GuardViolation | null {
  const tokens = tokenize(segment);
  if (tokens.length === 0) return null;

  const commandTokens = stripLeadingWrappers(tokens);
  if (commandTokens.length === 0) return null;

  const command = normalizeCommandToken(commandTokens[0]);

  const inlineViolation = evaluateInlineShell(command, commandTokens, config, depth);
  if (inlineViolation) return inlineViolation;

  if (command === "rm") {
    return evaluateRm(commandTokens, segment, config);
  }

  if (command === "git") {
    return evaluateGit(commandTokens, segment);
  }

  if (!config.includeExtendedRules) return null;

  if (command === "docker") {
    return evaluateDocker(commandTokens, segment);
  }

  if (command === "kubectl") {
    return evaluateKubectl(commandTokens, segment);
  }

  return evaluateDiskTools(command, commandTokens, segment);
}

function evaluateInlineShell(
  command: string,
  tokens: string[],
  config: GuardConfig,
  depth: number,
): GuardViolation | null {
  if (depth >= MAX_INLINE_DEPTH) return null;
  if (!["bash", "sh", "zsh"].includes(command)) return null;

  const args = tokens.slice(1);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg !== "-c" && arg !== "--command") continue;

    const inline = args[i + 1];
    if (!inline) continue;

    const nested = evaluateBashCommandInternal(inline, config, depth + 1).violation;
    if (!nested) continue;

    return {
      ...nested,
      segment: tokens.join(" "),
      reason: `Inline shell command matched blocked rule ${nested.ruleId}: ${nested.reason}`,
    };
  }

  return null;
}

function evaluateRm(tokens: string[], segment: string, config: GuardConfig): GuardViolation | null {
  const parsed = parseCommandArgs(tokens.slice(1));
  const hasRecursive =
    hasShortFlag(parsed.shortFlags, "r") ||
    hasShortFlag(parsed.shortFlags, "R") ||
    hasLongOption(parsed.longOptions, "recursive");
  const hasForce =
    hasShortFlag(parsed.shortFlags, "f") || hasLongOption(parsed.longOptions, "force");

  if (!hasRecursive || !hasForce) return null;

  if (
    parsed.positionals.length > 0 &&
    config.allowTempRecursiveForceRm &&
    parsed.positionals.every((target) => isTempTarget(target))
  ) {
    return null;
  }

  if (parsed.positionals.some((target) => isRootOrHomeTarget(target))) {
    return {
      ruleId: "rm.recursive-force-root-home",
      severity: "critical",
      reason: "Recursive forced rm targeting root or home paths is blocked",
      segment,
    };
  }

  return {
    ruleId: "rm.recursive-force",
    severity: "critical",
    reason: "Recursive forced rm is blocked to prevent destructive deletion",
    segment,
  };
}

function evaluateGit(tokens: string[], segment: string): GuardViolation | null {
  const subcommand = normalizeCommandToken(tokens[1]);
  const args = tokens.slice(2);

  if (subcommand === "checkout") return evaluateGitCheckout(args, segment);
  if (subcommand === "reset") return evaluateGitReset(args, segment);
  if (subcommand === "clean") return evaluateGitClean(args, segment);
  if (subcommand === "restore") return evaluateGitRestore(args, segment);
  if (subcommand === "stash") return evaluateGitStash(args, segment);
  if (subcommand === "push") return evaluateGitPush(args, segment);

  return null;
}

function evaluateGitCheckout(args: string[], segment: string): GuardViolation | null {
  if (!isCheckoutDiscard(args)) return null;

  return gitViolation(
    "git.checkout-discard",
    "high",
    "git checkout -- discards local file changes",
    segment,
  );
}

function evaluateGitReset(args: string[], segment: string): GuardViolation | null {
  const parsed = parseCommandArgs(args);
  if (hasLongOption(parsed.longOptions, "hard")) {
    return gitViolation(
      "git.reset-hard",
      "critical",
      "git reset --hard discards local changes",
      segment,
    );
  }

  if (hasLongOption(parsed.longOptions, "merge")) {
    return gitViolation(
      "git.reset-merge",
      "high",
      "git reset --merge can discard local merge state",
      segment,
    );
  }

  return null;
}

function evaluateGitClean(args: string[], segment: string): GuardViolation | null {
  const parsed = parseCommandArgs(args);
  const hasForce =
    hasShortFlag(parsed.shortFlags, "f") || hasLongOption(parsed.longOptions, "force");
  const hasDryRun =
    hasShortFlag(parsed.shortFlags, "n") || hasLongOption(parsed.longOptions, "dry-run");

  if (!hasForce || hasDryRun) return null;

  return gitViolation(
    "git.clean-force",
    "high",
    "git clean with force deletes untracked files",
    segment,
  );
}

function evaluateGitRestore(args: string[], segment: string): GuardViolation | null {
  const parsed = parseCommandArgs(args);
  const hasStaged =
    hasShortFlag(parsed.shortFlags, "S") || hasLongOption(parsed.longOptions, "staged");
  const hasWorktree =
    hasShortFlag(parsed.shortFlags, "W") || hasLongOption(parsed.longOptions, "worktree");

  if (hasWorktree) {
    return gitViolation(
      "git.restore-worktree",
      "high",
      "git restore --worktree discards working tree changes",
      segment,
    );
  }

  if (hasStaged || parsed.positionals.length === 0) return null;

  return gitViolation(
    "git.restore-path",
    "high",
    "git restore on paths discards working tree changes",
    segment,
  );
}

function evaluateGitStash(args: string[], segment: string): GuardViolation | null {
  if (normalizeCommandToken(args[0]) !== "clear") return null;

  return gitViolation(
    "git.stash-clear",
    "high",
    "git stash clear permanently removes all stashes",
    segment,
  );
}

function evaluateGitPush(args: string[], segment: string): GuardViolation | null {
  const parsed = parseCommandArgs(args);
  const hasForce =
    hasShortFlag(parsed.shortFlags, "f") || hasLongOption(parsed.longOptions, "force");

  if (!hasForce) return null;

  return gitViolation(
    "git.push-force",
    "high",
    "git push --force rewrites remote history",
    segment,
  );
}

function gitViolation(
  ruleId: string,
  severity: GuardSeverity,
  reason: string,
  segment: string,
): GuardViolation {
  return {
    ruleId,
    severity,
    reason,
    segment,
  };
}

function evaluateDocker(tokens: string[], segment: string): GuardViolation | null {
  const subcommand = normalizeCommandToken(tokens[1]);
  const subject = normalizeCommandToken(tokens[2]);

  if (subcommand === "system" && subject === "prune") {
    return {
      ruleId: "docker.system-prune",
      severity: "high",
      reason: "docker system prune deletes containers, images, and cache data",
      segment,
    };
  }

  if (subcommand === "volume" && subject === "prune") {
    return {
      ruleId: "docker.volume-prune",
      severity: "high",
      reason: "docker volume prune deletes unused volume data",
      segment,
    };
  }

  if (subcommand === "volume" && subject === "rm") {
    return {
      ruleId: "docker.volume-rm",
      severity: "high",
      reason: "docker volume rm permanently deletes volume data",
      segment,
    };
  }

  if (subcommand === "rm" || subcommand === "rmi") {
    const parsed = parseCommandArgs(tokens.slice(2));
    const hasForce =
      hasShortFlag(parsed.shortFlags, "f") || hasLongOption(parsed.longOptions, "force");
    if (hasForce) {
      return {
        ruleId: "docker.force-remove",
        severity: "high",
        reason: "Forced docker removal commands are blocked",
        segment,
      };
    }
  }

  return null;
}

function evaluateKubectl(tokens: string[], segment: string): GuardViolation | null {
  const subcommand = normalizeCommandToken(tokens[1]);
  if (subcommand !== "delete") return null;

  const parsed = parseCommandArgs(tokens.slice(2));
  const firstPositional = normalizeCommandToken(parsed.positionals[0]);

  if (["namespace", "ns"].includes(firstPositional)) {
    return {
      ruleId: "kubectl.delete-namespace",
      severity: "critical",
      reason: "kubectl delete namespace removes all resources in that namespace",
      segment,
    };
  }

  if (["pvc", "pv", "persistentvolumeclaim", "persistentvolume"].includes(firstPositional)) {
    return {
      ruleId: "kubectl.delete-storage",
      severity: "critical",
      reason: "kubectl delete on PV/PVC can destroy persistent data",
      segment,
    };
  }

  const deletesAll =
    hasShortFlag(parsed.shortFlags, "A") ||
    hasLongOption(parsed.longOptions, "all") ||
    hasLongOption(parsed.longOptions, "all-namespaces");

  if (deletesAll) {
    return {
      ruleId: "kubectl.delete-all",
      severity: "critical",
      reason: "kubectl delete --all or -A can remove many resources at once",
      segment,
    };
  }

  return null;
}

function evaluateDiskTools(
  command: string,
  tokens: string[],
  segment: string,
): GuardViolation | null {
  if (command === "dd") {
    const args = tokens.slice(1);
    const writesToDevice = args.some((arg) => arg.toLowerCase().startsWith("of=/dev/"));
    if (writesToDevice) {
      return {
        ruleId: "disk.dd-device-output",
        severity: "critical",
        reason: "dd writing to /dev/* can destroy disk data",
        segment,
      };
    }
  }

  if (command.startsWith("mkfs") || command === "wipefs") {
    return {
      ruleId: "disk.format-command",
      severity: "critical",
      reason: "Filesystem formatting commands are blocked",
      segment,
    };
  }

  return null;
}

function isCheckoutDiscard(args: string[]): boolean {
  const separatorIndex = args.indexOf("--");
  if (separatorIndex >= 0 && separatorIndex < args.length - 1) {
    return true;
  }

  const firstPositional = args.find((arg) => !isOptionToken(arg));
  if (!firstPositional) return false;

  if (firstPositional === ".") return true;
  if (firstPositional.startsWith("./") || firstPositional.startsWith("../")) return true;

  return false;
}

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "single") {
      escaped = true;
      continue;
    }

    if (!quote) {
      if (char === "'") {
        quote = "single";
        continue;
      }

      if (char === '"') {
        quote = "double";
        continue;
      }

      if (/\s/.test(char)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += char;
      continue;
    }

    if (quote === "single" && char === "'") {
      quote = null;
      continue;
    }

    if (quote === "double" && char === '"') {
      quote = null;
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function stripLeadingWrappers(tokens: string[]): string[] {
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";

    if (isEnvAssignment(token)) {
      index += 1;
      continue;
    }

    const command = normalizeCommandToken(token);
    if (command === "sudo") {
      index = consumeSudo(tokens, index + 1);
      continue;
    }

    if (command === "env") {
      index = consumeEnv(tokens, index + 1);
      continue;
    }

    if (command === "command") {
      index = consumeCommand(tokens, index + 1);
      continue;
    }

    if (command === "time" || command === "nohup" || command === "xargs") {
      index = consumeCommand(tokens, index + 1);
      continue;
    }

    if (command === "nice") {
      index = consumeNice(tokens, index + 1);
      continue;
    }

    if (command === "timeout") {
      index = consumeTimeout(tokens, index + 1);
      continue;
    }

    break;
  }

  return tokens.slice(index);
}

function consumeSudo(tokens: string[], start: number): number {
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--") return index + 1;
    if (!isOptionToken(token)) return index;

    if (optionNeedsValue(token, ["-u", "-g", "-h", "-p", "-C", "--user", "--group", "--host"])) {
      index += token.includes("=") ? 1 : 2;
      continue;
    }

    index += 1;
  }

  return index;
}

function consumeEnv(tokens: string[], start: number): number {
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--") {
      index += 1;
      break;
    }

    if (isEnvAssignment(token)) {
      index += 1;
      continue;
    }

    if (isOptionToken(token)) {
      if (optionNeedsValue(token, ["-u", "--unset"])) {
        index += token.includes("=") ? 1 : 2;
      } else {
        index += 1;
      }
      continue;
    }

    break;
  }

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!isEnvAssignment(token)) break;
    index += 1;
  }

  return index;
}

function consumeCommand(tokens: string[], start: number): number {
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--") return index + 1;
    if (!isOptionToken(token)) return index;
    index += 1;
  }

  return index;
}

function consumeNice(tokens: string[], start: number): number {
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!isOptionToken(token)) return index;

    if (optionNeedsValue(token, ["-n", "--adjustment"])) {
      index += token.includes("=") ? 1 : 2;
      continue;
    }

    index += 1;
  }

  return index;
}

function consumeTimeout(tokens: string[], start: number): number {
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!isOptionToken(token)) break;

    if (optionNeedsValue(token, ["-s", "--signal", "-k", "--kill-after"])) {
      index += token.includes("=") ? 1 : 2;
      continue;
    }

    index += 1;
  }

  if (index < tokens.length) {
    index += 1;
  }

  return index;
}

type ParsedArgs = {
  shortFlags: Set<string>;
  longOptions: string[];
  positionals: string[];
};

function parseCommandArgs(args: string[]): ParsedArgs {
  const shortFlags = new Set<string>();
  const longOptions: string[] = [];
  const positionals: string[] = [];
  let explicitPositionals = false;

  for (const arg of args) {
    if (explicitPositionals) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--") {
      explicitPositionals = true;
      continue;
    }

    if (arg.startsWith("--")) {
      longOptions.push(arg.slice(2).toLowerCase());
      continue;
    }

    if (isOptionToken(arg)) {
      const flags = arg.slice(1);
      for (const flag of flags) {
        shortFlags.add(flag);
      }
      continue;
    }

    positionals.push(arg);
  }

  return {
    shortFlags,
    longOptions,
    positionals,
  };
}

function hasLongOption(options: string[], option: string): boolean {
  return options.some((entry) => entry === option || entry.startsWith(`${option}=`));
}

function hasShortFlag(flags: Set<string>, flag: string): boolean {
  return flags.has(flag);
}

function normalizeCommandToken(token?: string): string {
  if (!token) return "";

  const normalized = token.trim().replace(/\\/g, "/");
  if (normalized.length === 0) return "";

  const parts = normalized.split("/");
  const base = parts[parts.length - 1] ?? normalized;

  return base.toLowerCase().replace(/\.exe$/, "");
}

function isOptionToken(token: string): boolean {
  return token.length > 1 && token.startsWith("-");
}

function optionNeedsValue(token: string, optionNames: string[]): boolean {
  return optionNames.some((name) => token === name || token.startsWith(`${name}=`));
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function isTempTarget(target: string): boolean {
  const normalized = normalizePathTarget(target);
  return TEMP_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function isRootOrHomeTarget(target: string): boolean {
  const normalized = normalizePathTarget(target);

  if (["/", "~", "$HOME", "${HOME}"].includes(normalized)) {
    return true;
  }

  if (["/*", "~/*", "$HOME/*", "${HOME}/*"].includes(normalized)) {
    return true;
  }

  return false;
}

function normalizePathTarget(target: string): string {
  const collapsed = target.trim().replace(/\\/g, "/");
  const withoutTrailingSlash = collapsed.replace(/\/+$/, "");
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : collapsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  return fallback;
}

function parseMode(raw: string | undefined): GuardMode {
  if (!raw) return DEFAULT_MODE;

  const normalized = raw.trim().toLowerCase();
  if (normalized === "off" || normalized === "warn" || normalized === "block") {
    return normalized;
  }

  return DEFAULT_MODE;
}
