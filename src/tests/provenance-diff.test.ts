import { describe, expect, it } from "vitest";
import { computePostImageRanges } from "../../packages/core/src/provenance/tooling/diff.ts";

describe("computePostImageRanges", () => {
  it("returns range for a single line replacement", () => {
    const before = "alpha\nbeta\ngamma";
    const after = "alpha\nbravo\ngamma";

    expect(computePostImageRanges(before, after)).toEqual([{ start_line: 2, end_line: 2 }]);
  });

  it("returns range for inserted block", () => {
    const before = "one\ntwo";
    const after = "one\ntwo\nthree\nfour";

    expect(computePostImageRanges(before, after)).toEqual([{ start_line: 3, end_line: 4 }]);
  });

  it("ignores delete-only hunks", () => {
    const before = "one\ntwo\nthree";
    const after = "one\nthree";

    expect(computePostImageRanges(before, after)).toEqual([]);
  });

  it("handles replacement with more lines", () => {
    const before = "one\ntwo\nthree";
    const after = "one\nalpha\nbeta\nthree";

    expect(computePostImageRanges(before, after)).toEqual([{ start_line: 2, end_line: 3 }]);
  });

  it("returns multiple ranges for separate hunks", () => {
    const before = "a\nb\nc\nd\nf";
    const after = "a\nx\nc\nd\ny\nf";

    expect(computePostImageRanges(before, after)).toEqual([
      { start_line: 2, end_line: 2 },
      { start_line: 5, end_line: 5 },
    ]);
  });

  it("returns 1-based ranges for insertions at start", () => {
    const before = "b";
    const after = "a\nb";

    expect(computePostImageRanges(before, after)).toEqual([{ start_line: 1, end_line: 1 }]);
  });

  it("ignores trailing newline when counting lines", () => {
    const before = "a\n";
    const after = "a\nb\n";

    expect(computePostImageRanges(before, after)).toEqual([{ start_line: 2, end_line: 2 }]);
  });

  it("normalizes CRLF input for diff-to-range output", () => {
    const before = "alpha\r\nbeta\r\ngamma";
    const after = "alpha\r\nbravo\r\ngamma";

    expect(computePostImageRanges(before, after)).toEqual([{ start_line: 2, end_line: 2 }]);
  });

  it("normalizes CR-only input for diff-to-range output", () => {
    const before = "alpha\rbeta\rgamma";
    const after = "alpha\rbravo\rgamma";

    expect(computePostImageRanges(before, after)).toEqual([{ start_line: 2, end_line: 2 }]);
  });

  it("stays stable for mixed line-ending fixtures", () => {
    const before = "alpha\r\nbeta\rgamma\n";
    const after = "alpha\nbeta\ngamma\n";

    expect(computePostImageRanges(before, after)).toEqual([]);
  });
});
