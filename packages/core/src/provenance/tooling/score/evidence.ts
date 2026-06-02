import { z } from "zod";
import { type ProvenanceEvidenceSource, type ProvenanceWarning } from "../contracts.ts";
import { dedupeSources } from "../shared.ts";
import { ProvRepoStateDataSchema } from "../state/internal.ts";

export function buildRepoSources(
  repo: z.infer<typeof ProvRepoStateDataSchema>,
): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: "branch",
      ref: repo.branch.ref ?? "HEAD",
      label: repo.branch.name ?? "detached HEAD",
      detail: repo.branch.detectionMethod,
    },
    {
      kind: "git",
      id: "base",
      ref: repo.base.ref ?? repo.base.detectionKind,
      label: "base",
      detail: repo.base.detectionMethod,
    },
    {
      kind: "git",
      id: "HEAD",
      ref: repo.head.ref,
      label: repo.head.branchName ?? "detached HEAD",
      detail: repo.head.shortCommit ?? "HEAD unavailable",
    },
    {
      kind: "git",
      id: "index",
      ref: repo.staged.ref,
      label: "staged",
      detail: `${repo.staged.count} file(s)`,
    },
    {
      kind: "git",
      id: "worktree",
      ref: repo.unstaged.ref,
      label: "unstaged",
      detail: `${repo.unstaged.count} file(s)`,
    },
    {
      kind: "git",
      id: "untracked",
      ref: repo.untracked.ref,
      label: "untracked",
      detail: `${repo.untracked.count} file(s)`,
    },
  ];

  return dedupeSources(sources);
}

export function toRepoAmbiguityWarnings(
  repo: z.infer<typeof ProvRepoStateDataSchema>,
): ProvenanceWarning[] {
  return repo.ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
}
