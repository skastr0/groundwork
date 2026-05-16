import type { ProvBlockReadData, ProvReadData } from "./schemas.ts";

export function buildReadSummary(data: ProvReadData): string {
  const branchLabel = data.repo.branch.name ?? "detached HEAD";
  const baseLabel = data.repo.base.ref ?? "base unresolved";
  const contentLabel = data.content.exists
    ? `${data.content.bounds.returned} byte(s)${data.content.bounds.truncated ? ", truncated" : ""}`
    : "layer absent";

  return `Read ${data.content.layer} layer for ${data.resolvedPath}: ${contentLabel}, repo ${branchLabel} against ${baseLabel}.`;
}

export function buildBlockReadSummary(data: ProvBlockReadData): string {
  const branchLabel = data.repo.branch.name ?? "detached HEAD";
  const baseLabel = data.repo.base.ref ?? "base unresolved";
  const contentLabel = data.content.exists
    ? `${data.content.lines.length} line(s) from ${data.content.window.startLine}-${data.content.window.endLine}${data.content.bounds.truncated ? ", truncated" : ""}`
    : "layer absent";
  const nearbyDiffRanges = data.diff.comparisons.reduce(
    (total, comparison) => total + comparison.nearbyRanges.length,
    0,
  );

  return `Read ${data.content.layer} block for ${data.resolvedPath}:${data.content.focus.startLine}-${data.content.focus.endLine}: ${contentLabel}, ${data.lineage.data.lineage.length} nearby lineage item(s), ${nearbyDiffRanges} local diff range(s), repo ${branchLabel} against ${baseLabel}.`;
}

export function toLineageHints(options: {
  warnings: readonly { message: string }[];
  bounds: { truncated: boolean; returned: number };
}): string[] {
  const hints = options.warnings.map((warning) => warning.message);

  if (options.bounds.truncated) {
    hints.push(
      `Nearby lineage truncated to ${options.bounds.returned} item(s); rerun with a larger limit to inspect more.`,
    );
  }

  return [...new Set(hints)];
}
