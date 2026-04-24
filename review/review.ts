/**
 * Core review functionality - separated from plugin for testability.
 *
 * This module contains all the git operations and parsing logic used by
 * the review plugin tools.
 */

import type { PluginInput } from "@opencode-ai/plugin";
import { runProcessText, type ProcessCommand } from "../shared/effect-runtime.ts";
import { logger } from "./utils/logger.ts";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DIFF_COMMAND_TIMEOUT_MS = 120_000;

/**
 * Shell interface - matches Bun shell API
 */
export type Shell = PluginInput["$"];

/**
 * Truncate output to prevent context overflow
 */
export function truncate(text: string, max: number = 50000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n... [truncated ${text.length - max} characters]`;
}

/**
 * Parsed commit structure
 */
export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export type CommitLogFormat = "short" | "medium" | "full";

/**
 * Parse commit log into structured format
 * Format expected: hash|shortHash|author|date|message
 */
export function parseCommits(logOutput: string): Commit[] {
  if (!logOutput.trim()) return [];

  const commits: Commit[] = [];
  const lines = logOutput.trim().split("\n");
  for (const line of lines) {
    const [hash, shortHash, author, date, ...messageParts] = line.split("|");
    if (hash && shortHash) {
      commits.push({
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        author: author?.trim() ?? "unknown",
        date: date?.trim() ?? "",
        message: messageParts.join("|").trim(),
      });
    }
  }
  return commits;
}

/**
 * Parsed file change structure
 */
export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

/**
 * Parse diff stat into file changes
 */
export function parseDiffStat(diffStat: string): FileChange[] {
  if (!diffStat.trim()) return [];

  const changes: FileChange[] = [];
  const lines = diffStat.trim().split("\n");

  for (const line of lines) {
    // Skip summary line (e.g., "10 files changed, 100 insertions(+), 50 deletions(-)")
    if (line.includes("files changed") || line.includes("file changed")) continue;

    // Parse lines like: " path/to/file.ts | 25 +++---"
    const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s*(.*)$/);
    if (match) {
      const [, path, , visual] = match;
      const additions = (visual?.match(/\+/g) || []).length;
      const deletions = (visual?.match(/-/g) || []).length;
      if (path) {
        changes.push({
          path: path.trim(),
          additions,
          deletions,
          status: additions > 0 && deletions > 0 ? "modified" : additions > 0 ? "added" : "deleted",
        });
      }
    }
  }

  return changes;
}

/**
 * File status from git name-status
 */
export interface FileStatus {
  status: string;
  path: string;
  newPath?: string;
}

/**
 * Parse git diff --name-status output
 */
export function parseNameStatus(nameStatus: string): FileStatus[] {
  if (!nameStatus.trim()) return [];

  const files: FileStatus[] = [];
  const lines = nameStatus.trim().split("\n").filter(Boolean);

  for (const line of lines) {
    const parts = line.split("\t");
    const statusCode = parts[0]?.charAt(0) ?? "";
    let status: string;

    switch (statusCode) {
      case "A":
        status = "added";
        break;
      case "M":
        status = "modified";
        break;
      case "D":
        status = "deleted";
        break;
      case "R":
        status = "renamed";
        break;
      case "C":
        status = "copied";
        break;
      default:
        status = "unknown";
    }

    files.push({
      status,
      path: parts[1] ?? "",
      newPath: statusCode === "R" || statusCode === "C" ? parts[2] : undefined,
    });
  }

  return files;
}

/**
 * Base branch detection result
 */
export interface BaseBranchResult {
  base: string | null;
  method: string;
  error?: string;
}

/**
 * ReviewManager - handles all git operations for branch review
 */
export class ReviewManager {
  constructor(private $: Shell) {}

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async runCommand(
    command: string,
    cmd: ProcessCommand,
    fallback: (message: string) => string = () => "",
    options: { timeoutMs?: number } = {},
  ): Promise<string> {
    const isGit = command.startsWith("git ");
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    logger.debug(isGit ? "Executing git command" : "Executing command", { command });

    try {
      return await runProcessText({
        shell: this.$,
        cmd,
        timeoutMs,
        trim: false,
      });
    } catch (error) {
      const message = this.formatError(error);
      logger.error(isGit ? "Git command failed" : "Command failed", {
        command,
        error: message,
      });
      return fallback(message);
    }
  }

  private logBaseBranchResult(result: BaseBranchResult): BaseBranchResult {
    logger.info("Base branch detection result", {
      base: result.base,
      method: result.method,
      error: result.error,
    });
    return result;
  }

  private getCommitFormat(format: CommitLogFormat): string {
    switch (format) {
      case "short":
        return "%h %s";
      case "full":
        return "commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n    %s%n%n%b%n---";
      default:
        return "%H|%h|%an|%ad|%s";
    }
  }

  private getExplicitBaseCandidates(explicitBase: string): string[] {
    const trimmed = explicitBase.trim();
    if (!trimmed) {
      return [];
    }

    const directCandidates = [trimmed];
    if (trimmed.startsWith("refs/remotes/")) {
      directCandidates.push(trimmed.replace(/^refs\/remotes\//, ""));
    } else if (trimmed.startsWith("refs/heads/")) {
      directCandidates.push(trimmed.replace(/^refs\/heads\//, ""));
    }

    const remoteCandidates = directCandidates
      .filter((candidate) => !candidate.startsWith("origin/") && !candidate.startsWith("refs/"))
      .map((candidate) => `origin/${candidate}`);

    return [...new Set([...directCandidates, ...remoteCandidates])];
  }

  /**
   * Detect the parent/base branch using multiple strategies:
   * 1. Check if there's a PR and get baseRefName
   * 2. Check remote HEAD symbolic ref (fast, local, works for any default branch)
   * 3. Query GitHub API for default branch (authoritative)
   * 4. Look for common default branches (main, master, develop)
   * 5. Use tracking branch configuration
   * 6. Fall back to first remote branch found
   */
  async detectBaseBranch(explicitBase?: string): Promise<BaseBranchResult> {
    logger.info("ReviewManager detectBaseBranch start", { explicitBase });

    if (explicitBase) {
      const trimmedBase = explicitBase.trim();
      logger.debug("Detecting base branch from explicit input", {
        strategy: "explicit",
        explicitBase: trimmedBase,
      });

      const candidates = this.getExplicitBaseCandidates(trimmedBase);
      for (const candidate of candidates) {
        const exists = await this.runCommand(
          `git rev-parse --verify ${candidate}`,
          ["git", "rev-parse", "--verify", candidate],
          () => "",
        );
        if (!exists.trim()) {
          continue;
        }

        const method =
          candidate === trimmedBase
            ? "explicit"
            : candidate.startsWith("origin/") &&
                !trimmedBase.startsWith("origin/") &&
                !trimmedBase.startsWith("refs/remotes/")
              ? "explicit (remote)"
              : "explicit (normalized)";

        return this.logBaseBranchResult({ base: candidate, method });
      }

      return this.logBaseBranchResult({
        base: null,
        method: "explicit",
        error: `Branch '${trimmedBase}' not found`,
      });
    }

    logger.debug("Detecting base branch from PR", { strategy: "pr" });
    try {
      const prBase = await this.runCommand(
        "gh pr view --json baseRefName --jq '.baseRefName'",
        ["gh", "pr", "view", "--json", "baseRefName", "--jq", ".baseRefName"],
        () => "",
      );
      if (prBase.trim()) {
        const localExists = await this.runCommand(
          `git rev-parse --verify ${prBase.trim()}`,
          ["git", "rev-parse", "--verify", prBase.trim()],
          () => "",
        );
        if (localExists.trim()) {
          return this.logBaseBranchResult({ base: prBase.trim(), method: "PR base (local)" });
        }
        const remoteExists = await this.runCommand(
          `git rev-parse --verify origin/${prBase.trim()}`,
          ["git", "rev-parse", "--verify", `origin/${prBase.trim()}`],
          () => "",
        );
        if (remoteExists.trim()) {
          return this.logBaseBranchResult({
            base: `origin/${prBase.trim()}`,
            method: "PR base (remote)",
          });
        }
      }
    } catch {
      // No PR exists or gh CLI not available
    }

    logger.debug("Detecting base branch from remote HEAD", { strategy: "remote-head" });
    try {
      const symbolicHead = await this.runCommand(
        "git symbolic-ref refs/remotes/origin/HEAD",
        ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
        () => "",
      );
      if (symbolicHead.trim()) {
        const branch = symbolicHead.trim().replace("refs/remotes/", "");
        const exists = await this.runCommand(
          `git rev-parse --verify ${branch}`,
          ["git", "rev-parse", "--verify", branch],
          () => "",
        );
        if (exists.trim()) {
          return this.logBaseBranchResult({ base: branch, method: "remote HEAD (symbolic-ref)" });
        }
      }
    } catch {
      // symbolic-ref not set
    }

    logger.debug("Detecting base branch from GitHub default", { strategy: "github-default" });
    try {
      const ghDefault = await this.runCommand(
        "gh api repos/:owner/:repo --jq '.default_branch'",
        ["gh", "api", "repos/:owner/:repo", "--jq", ".default_branch"],
        () => "",
      );
      if (ghDefault.trim()) {
        const branch = `origin/${ghDefault.trim()}`;
        const exists = await this.runCommand(
          `git rev-parse --verify ${branch}`,
          ["git", "rev-parse", "--verify", branch],
          () => "",
        );
        if (exists.trim()) {
          return this.logBaseBranchResult({ base: branch, method: "GitHub default branch" });
        }
      }
    } catch {
      // gh CLI not available or not a GitHub repo
    }

    const commonBranches = ["main", "master", "develop", "development"];
    logger.debug("Detecting base branch from common defaults", {
      strategy: "default-branches",
      branches: commonBranches,
    });
    for (const branch of commonBranches) {
      const localExists = await this.runCommand(
        `git rev-parse --verify ${branch}`,
        ["git", "rev-parse", "--verify", branch],
        () => "",
      );
      if (localExists.trim()) {
        return this.logBaseBranchResult({ base: branch, method: `default branch (${branch})` });
      }
      const remoteExists = await this.runCommand(
        `git rev-parse --verify origin/${branch}`,
        ["git", "rev-parse", "--verify", `origin/${branch}`],
        () => "",
      );
      if (remoteExists.trim()) {
        return this.logBaseBranchResult({
          base: `origin/${branch}`,
          method: `default branch (origin/${branch})`,
        });
      }
    }

    logger.debug("Detecting base branch from tracking branch", { strategy: "tracking" });
    const currentBranch = (
      await this.runCommand(
        "git branch --show-current",
        ["git", "branch", "--show-current"],
        () => "",
      )
    ).trim();
    if (currentBranch) {
      const upstream = await this.runCommand(
        `git config --get branch.${currentBranch}.merge`,
        ["git", "config", "--get", `branch.${currentBranch}.merge`],
        () => "",
      );
      const remote = await this.runCommand(
        `git config --get branch.${currentBranch}.remote`,
        ["git", "config", "--get", `branch.${currentBranch}.remote`],
        () => "",
      );
      if (upstream.trim() && remote.trim()) {
        const trackingRef = `${remote.trim()}/${upstream.trim().replace("refs/heads/", "")}`;
        const trackingExists = await this.runCommand(
          `git rev-parse --verify ${trackingRef}`,
          ["git", "rev-parse", "--verify", trackingRef],
          () => "",
        );
        if (trackingExists.trim()) {
          return this.logBaseBranchResult({ base: trackingRef, method: "tracking branch" });
        }
      }
    }

    logger.debug("Detecting base branch from remote fallback", { strategy: "remote-fallback" });
    const remoteBranches = await this.runCommand(
      "git branch -r",
      ["git", "branch", "-r"],
      () => "",
    );
    const branches = remoteBranches
      .trim()
      .split("\n")
      .map((branch) => branch.trim())
      .filter((branch) => branch && !branch.includes("HEAD") && !branch.includes(currentBranch));
    const firstBranch = branches[0];
    if (firstBranch) {
      return this.logBaseBranchResult({ base: firstBranch, method: "first remote branch" });
    }

    return this.logBaseBranchResult({
      base: null,
      method: "none",
      error: "Could not detect base branch. Please specify one explicitly.",
    });
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(): Promise<string> {
    logger.info("ReviewManager getCurrentBranch start");
    const branch = (
      await this.runCommand(
        "git branch --show-current",
        ["git", "branch", "--show-current"],
        () => "",
      )
    ).trim();
    logger.info("ReviewManager getCurrentBranch end", { branch });
    return branch;
  }

  /**
   * Get commit log output between base and HEAD
   */
  async getCommitLog(
    baseBranch: string,
    options: { limit?: number; includeMerges?: boolean; format?: CommitLogFormat } = {},
  ): Promise<string> {
    const { limit = 50, includeMerges = false, format = "medium" } = options;
    logger.info("ReviewManager getCommitLog start", {
      base: baseBranch,
      limit,
      include_merges: includeMerges,
      format,
    });
    const mergeFlag = includeMerges ? "" : "--no-merges";
    const gitFormat = this.getCommitFormat(format);
    const command = `git log ${mergeFlag} --format="${gitFormat}" --date=short -${limit} ${baseBranch}..HEAD`;

    const result = await this.runCommand(
      command,
      [
        "git",
        "log",
        ...(includeMerges ? [] : (["--no-merges"] as const)),
        `--format=${gitFormat}`,
        "--date=short",
        `-${limit}`,
        `${baseBranch}..HEAD`,
      ],
      (message) => `Error: ${message}`,
    );

    logger.info("ReviewManager getCommitLog end", {
      base: baseBranch,
      format,
      error: result.startsWith("Error:") ? result : undefined,
    });

    return result;
  }

  /**
   * Get commits between base and HEAD
   */
  async getCommitsWithStatus(
    baseBranch: string,
    options: { limit?: number; includeMerges?: boolean } = {},
  ): Promise<{ commits: Commit[]; error?: string }> {
    const { limit = 50, includeMerges = false } = options;
    logger.info("ReviewManager getCommits start", {
      base: baseBranch,
      limit,
      include_merges: includeMerges,
    });

    const result = await this.getCommitLog(baseBranch, {
      limit,
      includeMerges,
      format: "medium",
    });

    if (result.startsWith("Error:")) {
      logger.info("ReviewManager getCommits end", {
        base: baseBranch,
        error: result,
      });
      return { commits: [], error: result };
    }

    const commits = parseCommits(result);
    logger.info("ReviewManager commit summary", {
      base: baseBranch,
      commits: commits.length,
      include_merges: includeMerges,
    });
    logger.info("ReviewManager getCommits end", { base: baseBranch, commits: commits.length });
    return { commits };
  }

  /**
   * Get commits between base and HEAD
   */
  async getCommits(
    baseBranch: string,
    options: { limit?: number; includeMerges?: boolean } = {},
  ): Promise<Commit[]> {
    const result = await this.getCommitsWithStatus(baseBranch, options);
    return result.commits;
  }

  /**
   * Get diff statistics between base and HEAD
   */
  async getDiffStat(baseBranch: string): Promise<{
    raw: string;
    files: FileChange[];
    summary: { filesChanged: number; additions: number; deletions: number };
  }> {
    logger.info("ReviewManager getDiffStat start", { base: baseBranch });
    const command = `git diff --stat ${baseBranch}..HEAD`;
    const diffStat = await this.runCommand(
      command,
      ["git", "diff", "--stat", `${baseBranch}..HEAD`],
      () => "",
    );

    const files = parseDiffStat(diffStat);

    // Parse summary numbers
    const summaryMatch = diffStat.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );

    const summary = {
      filesChanged: summaryMatch?.[1] ? parseInt(summaryMatch[1]) : files.length,
      additions: summaryMatch?.[2] ? parseInt(summaryMatch[2]) : 0,
      deletions: summaryMatch?.[3] ? parseInt(summaryMatch[3]) : 0,
    };

    logger.info("ReviewManager diff summary", {
      base: baseBranch,
      files_changed: summary.filesChanged,
      additions: summary.additions,
      deletions: summary.deletions,
    });
    logger.info("ReviewManager getDiffStat end", {
      base: baseBranch,
      files_changed: summary.filesChanged,
    });

    return {
      raw: diffStat,
      files,
      summary,
    };
  }

  /**
   * Get diff output between base and HEAD
   */
  async getDiffOutput(
    baseBranch: string,
    options: { path?: string; statOnly?: boolean; nameOnly?: boolean; timeoutMs?: number } = {},
  ): Promise<string> {
    const {
      path,
      statOnly = false,
      nameOnly = false,
      timeoutMs = DIFF_COMMAND_TIMEOUT_MS,
    } = options;
    let command: string;
    let cmd: ProcessCommand;

    logger.info("ReviewManager getDiffOutput start", {
      base: baseBranch,
      path,
      stat_only: statOnly,
      name_only: nameOnly,
      timeout_ms: timeoutMs,
    });

    if (nameOnly) {
      if (path) {
        command = `git diff --name-only ${baseBranch}..HEAD -- "${path}"`;
        cmd = ["git", "diff", "--name-only", `${baseBranch}..HEAD`, "--", path];
      } else {
        command = `git diff --name-only ${baseBranch}..HEAD`;
        cmd = ["git", "diff", "--name-only", `${baseBranch}..HEAD`];
      }
    } else if (statOnly) {
      if (path) {
        command = `git diff --stat ${baseBranch}..HEAD -- "${path}"`;
        cmd = ["git", "diff", "--stat", `${baseBranch}..HEAD`, "--", path];
      } else {
        command = `git diff --stat ${baseBranch}..HEAD`;
        cmd = ["git", "diff", "--stat", `${baseBranch}..HEAD`];
      }
    } else {
      if (path) {
        command = `git diff ${baseBranch}..HEAD -- "${path}"`;
        cmd = ["git", "diff", `${baseBranch}..HEAD`, "--", path];
      } else {
        command = `git diff ${baseBranch}..HEAD`;
        cmd = ["git", "diff", `${baseBranch}..HEAD`];
      }
    }

    const result = await this.runCommand(command, cmd, (message) => `Error: ${message}`, {
      timeoutMs,
    });

    logger.info("ReviewManager getDiffOutput end", {
      base: baseBranch,
      path,
      stat_only: statOnly,
      name_only: nameOnly,
      timeout_ms: timeoutMs,
      error: result.startsWith("Error:") ? result : undefined,
    });

    return result;
  }

  /**
   * Get full diff content between base and HEAD
   */
  async getDiff(baseBranch: string, path?: string): Promise<string> {
    logger.info("ReviewManager getDiff start", { base: baseBranch, path });
    const result = await this.getDiffOutput(baseBranch, { path });
    logger.info("ReviewManager getDiff end", { base: baseBranch, path });
    return result;
  }

  /**
   * Get changed files with status
   */
  async getChangedFilesWithStatus(
    baseBranch: string,
    filter?: "all" | "added" | "modified" | "deleted" | "renamed",
  ): Promise<{ files: FileStatus[]; error?: string }> {
    const filterValue = filter ?? "all";
    logger.info("ReviewManager getChangedFiles start", {
      base: baseBranch,
      filter: filterValue,
    });
    const command = `git diff --name-status ${baseBranch}..HEAD`;
    const result = await this.runCommand(
      command,
      ["git", "diff", "--name-status", `${baseBranch}..HEAD`],
      (message) => `Error: ${message}`,
    );

    if (result.startsWith("Error:")) {
      logger.info("ReviewManager getChangedFiles end", {
        base: baseBranch,
        filter: filterValue,
        error: result,
      });
      return { files: [], error: result };
    }

    const files = parseNameStatus(result);
    const filteredFiles =
      filterValue === "all" ? files : files.filter((f) => f.status === filterValue);

    logger.info("ReviewManager files summary", {
      base: baseBranch,
      files_changed: filteredFiles.length,
      filter: filterValue,
    });
    logger.info("ReviewManager getChangedFiles end", {
      base: baseBranch,
      files_changed: filteredFiles.length,
      filter: filterValue,
    });

    return { files: filteredFiles };
  }

  /**
   * Get changed files with status
   */
  async getChangedFiles(
    baseBranch: string,
    filter?: "all" | "added" | "modified" | "deleted" | "renamed",
  ): Promise<FileStatus[]> {
    const result = await this.getChangedFilesWithStatus(baseBranch, filter);
    return result.files;
  }
}
