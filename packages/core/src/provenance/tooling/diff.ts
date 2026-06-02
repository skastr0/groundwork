export interface LineRange {
  start_line: number;
  end_line: number;
}

type DiffOp = {
  type: "equal" | "insert" | "delete";
  line: string;
};

function normalizeLines(content: string): string[] {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.endsWith("\n")) {
    const trimmed = normalized.slice(0, -1);
    return trimmed ? trimmed.split("\n") : [];
  }
  return normalized.split("\n");
}

function diffLines(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return after.map((line) => ({ type: "insert", line }));
  if (m === 0) return before.map((line) => ({ type: "delete", line }));

  const max = n + m;
  const offset = max;
  let v = Array.from({ length: 2 * max + 1 }, () => 0);
  const snapshots: number[][] = [];

  for (let d = 0; d <= max; d += 1) {
    const vNext = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const kIndex = k + offset;
      let x: number;
      const left = v[kIndex - 1] ?? 0;
      const right = v[kIndex + 1] ?? 0;
      if (k === -d || (k !== d && left < right)) {
        x = right;
      } else {
        x = left + 1;
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      vNext[kIndex] = x;
      if (x >= n && y >= m) {
        snapshots.push(vNext);
        return backtrack(snapshots, before, after, offset);
      }
    }
    snapshots.push(vNext);
    v = vNext;
  }

  return [];
}

function backtrack(snapshots: number[][], before: string[], after: string[], offset: number): DiffOp[] {
  let x = before.length;
  let y = after.length;
  const ops: DiffOp[] = [];

  for (let d = snapshots.length - 1; d >= 0; d -= 1) {
    const v = snapshots[d] ?? [];
    const k = x - y;
    const kIndex = k + offset;
    let prevK: number;

    if (k === -d || (k !== d && (v[kIndex - 1] ?? 0) < (v[kIndex + 1] ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v[prevK + offset] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", line: before[x - 1] ?? "" });
      x -= 1;
      y -= 1;
    }

    if (d === 0) break;

    if (x === prevX) {
      ops.push({ type: "insert", line: after[y - 1] ?? "" });
      y -= 1;
    } else {
      ops.push({ type: "delete", line: before[x - 1] ?? "" });
      x -= 1;
    }
  }

  return ops.reverse();
}

export function computePostImageRanges(before: string, after: string): LineRange[] {
  const beforeLines = normalizeLines(before);
  const afterLines = normalizeLines(after);
  const ops = diffLines(beforeLines, afterLines);
  const ranges: LineRange[] = [];

  let afterLine = 1;
  let inHunk = false;
  let hunkStart = 0;
  let insertedCount = 0;

  const finalizeHunk = () => {
    if (insertedCount > 0) {
      ranges.push({
        start_line: hunkStart,
        end_line: hunkStart + insertedCount - 1,
      });
    }
    inHunk = false;
    insertedCount = 0;
  };

  for (const op of ops) {
    if (op.type === "equal") {
      if (inHunk) finalizeHunk();
      afterLine += 1;
      continue;
    }

    if (!inHunk) {
      inHunk = true;
      hunkStart = afterLine;
    }

    if (op.type === "insert") {
      insertedCount += 1;
      afterLine += 1;
    }
  }

  if (inHunk) finalizeHunk();

  return ranges;
}
