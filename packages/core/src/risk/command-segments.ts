type SegmentQuote = "single" | "double" | null;
type SegmentControlResult = "none" | "single" | "pair";

interface SegmentSplitState {
  segments: string[];
  current: string;
  quote: SegmentQuote;
  escaped: boolean;
}

export function splitCommandSegments(raw: string): string[] {
  const state: SegmentSplitState = {
    segments: [],
    current: "",
    quote: null,
    escaped: false,
  };

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    const next = raw[index + 1] ?? "";

    if (consumeEscapedCharacter(state, char)) continue;
    if (beginEscape(state, char)) continue;

    const controlResult = consumeUnquotedControl(state, char, next);
    if (controlResult === "pair") {
      index += 1;
      continue;
    }
    if (controlResult === "single") continue;

    if (consumeQuoteBoundary(state, char)) continue;
    appendCurrent(state, char);
  }

  pushSegment(state);
  return state.segments;
}

function consumeEscapedCharacter(state: SegmentSplitState, char: string): boolean {
  if (!state.escaped) return false;

  appendCurrent(state, char);
  state.escaped = false;
  return true;
}

function beginEscape(state: SegmentSplitState, char: string): boolean {
  if (char !== "\\" || state.quote === "single") return false;

  appendCurrent(state, char);
  state.escaped = true;
  return true;
}

function consumeUnquotedControl(
  state: SegmentSplitState,
  char: string,
  next: string,
): SegmentControlResult {
  if (state.quote) return "none";

  if (char === ";" || char === "\n") {
    closeCurrentSegment(state);
    return "single";
  }

  if ((char === "&" || char === "|") && next === char) {
    closeCurrentSegment(state);
    return "pair";
  }

  if (char === "|" || char === "&") {
    closeCurrentSegment(state);
    return "single";
  }

  return "none";
}

function consumeQuoteBoundary(state: SegmentSplitState, char: string): boolean {
  if (!state.quote) {
    if (char !== "'" && char !== '"') return false;

    state.quote = char === "'" ? "single" : "double";
    appendCurrent(state, char);
    return true;
  }

  if (state.quote === "single" && char === "'") {
    state.quote = null;
    appendCurrent(state, char);
    return true;
  }

  if (state.quote === "double" && char === '"') {
    state.quote = null;
    appendCurrent(state, char);
    return true;
  }

  return false;
}

function appendCurrent(state: SegmentSplitState, char: string): void {
  state.current += char;
}

function closeCurrentSegment(state: SegmentSplitState): void {
  pushSegment(state);
  state.current = "";
}

function pushSegment(state: SegmentSplitState): void {
  const trimmed = state.current.trim();
  if (trimmed.length > 0) {
    state.segments.push(trimmed);
  }
}
