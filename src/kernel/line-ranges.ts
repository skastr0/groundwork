export type LineRangeLike = {
  startLine: number;
  endLine: number;
};

export function cloneLineRanges(
  ranges: readonly LineRangeLike[] | undefined,
): LineRangeLike[] | undefined {
  return ranges?.map((range) => ({
    startLine: range.startLine,
    endLine: range.endLine,
  }));
}

export function mergeLineRanges(
  left: readonly LineRangeLike[] | undefined,
  right: readonly LineRangeLike[] | undefined,
): LineRangeLike[] | undefined {
  const combined = [...(left ?? []), ...(right ?? [])]
    .map((range) => ({
      startLine: range.startLine,
      endLine: range.endLine,
    }))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  if (combined.length === 0) {
    return undefined;
  }

  const merged: LineRangeLike[] = [combined[0]!];
  for (const current of combined.slice(1)) {
    const previous = merged[merged.length - 1]!;
    if (current.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, current.endLine);
      continue;
    }

    merged.push(current);
  }

  return merged;
}
