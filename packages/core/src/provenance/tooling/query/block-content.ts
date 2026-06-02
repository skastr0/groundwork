import {
  DEFAULT_PROVENANCE_BYTE_LIMIT,
  resolveBoundedNumber,
  type ProvenanceContentLayer,
} from "../args.ts";
import type {
  ProvenanceBounds,
  ProvenanceEvidenceSource,
  ProvenanceWarning,
} from "../contracts.ts";
import type { LocalFileLayerState } from "../state/internal.ts";
import {
  buildContentHints,
  createContentWarning,
} from "./text-content.ts";
import type {
  BlockLine,
  ProvBlockContent,
  RequestedBlockSpan,
  ResolvedBlockWindow,
} from "./schemas.ts";

type RequestedWindowOptions = {
  startLine: number;
  endLine: number;
  radius: number | undefined;
  windowStart: number | undefined;
  windowEnd: number | undefined;
  totalLines: number;
};

function hasExplicitWindow(options: RequestedWindowOptions): boolean {
  return options.windowStart !== undefined || options.windowEnd !== undefined;
}

function validateRequestedWindow(options: RequestedWindowOptions): void {
  validateRequestedSpan(options);
  validateWindowMode(options);
  validateWindowRange(options);
  validateWindowContainsFocus(options);
}

function validateRequestedSpan(options: RequestedWindowOptions): void {
  if (options.endLine < options.startLine) {
    throw new Error("end_line must be greater than or equal to start_line.");
  }
}

function validateWindowMode(options: RequestedWindowOptions): void {
  const explicitWindow = hasExplicitWindow(options);

  if (explicitWindow && options.radius !== undefined) {
    throw new Error("radius cannot be combined with window_start or window_end.");
  }

  if (explicitWindow && (options.windowStart === undefined || options.windowEnd === undefined)) {
    throw new Error("window_start and window_end must be provided together.");
  }
}

function validateWindowRange(options: RequestedWindowOptions): void {
  if (
    options.windowStart !== undefined &&
    options.windowEnd !== undefined &&
    options.windowEnd < options.windowStart
  ) {
    throw new Error("window_end must be greater than or equal to window_start.");
  }
}

function validateWindowContainsFocus(options: RequestedWindowOptions): void {
  if (
    options.windowStart !== undefined &&
    options.windowEnd !== undefined &&
    (options.windowStart > options.startLine || options.windowEnd < options.endLine)
  ) {
    throw new Error("Explicit window must fully include the requested start_line and end_line.");
  }
}

function resolveWindowSource(options: RequestedWindowOptions): ResolvedBlockWindow["source"] {
  if (options.windowStart !== undefined) {
    return "explicit";
  }

  return options.radius ? "radius" : "focus";
}

function resolveRequestedBounds(options: RequestedWindowOptions): RequestedBlockSpan {
  return {
    startLine: options.windowStart ?? Math.max(1, options.startLine - (options.radius ?? 0)),
    endLine: options.windowEnd ?? options.endLine + (options.radius ?? 0),
  };
}

function clampRequestedBounds(
  requested: RequestedBlockSpan,
  totalLines: number,
): RequestedBlockSpan {
  if (totalLines <= 0) {
    return requested;
  }

  return {
    startLine: Math.min(requested.startLine, totalLines),
    endLine: Math.min(requested.endLine, totalLines),
  };
}

export function resolveRequestedWindow(options: {
  startLine: number;
  endLine: number;
  radius: number | undefined;
  windowStart: number | undefined;
  windowEnd: number | undefined;
  totalLines: number;
}): ResolvedBlockWindow {
  validateRequestedWindow(options);

  const source = resolveWindowSource(options);
  const requested = resolveRequestedBounds(options);
  const clamped = clampRequestedBounds(requested, options.totalLines);
  return {
    startLine: clamped.startLine,
    endLine: clamped.endLine,
    source,
    clamped: requested.startLine !== clamped.startLine || requested.endLine !== clamped.endLine,
  };
}

export function buildBlockLines(options: {
  lines: readonly string[];
  focus: RequestedBlockSpan;
  window: ResolvedBlockWindow;
}): BlockLine[] {
  if (options.lines.length === 0 || options.window.endLine < options.window.startLine) {
    return [];
  }

  return options.lines
    .slice(options.window.startLine - 1, options.window.endLine)
    .map((text, index) => {
      const number = options.window.startLine + index;
      return {
        number,
        text,
        inFocus: number >= options.focus.startLine && number <= options.focus.endLine,
      };
    });
}

export function applyBlockLineBudget(
  lines: readonly BlockLine[],
  requestedBytes: number | undefined,
): {
  lines: BlockLine[];
  text: string;
  bounds: ProvenanceBounds;
  byteCount: number;
} {
  const limit = resolveBoundedNumber(requestedBytes, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const byteCount = Buffer.byteLength(lines.map((line) => line.text).join("\n"), "utf8");

  if (lines.length === 0 || byteCount <= limit) {
    const text = lines.map((line) => line.text).join("\n");
    return {
      lines: [...lines],
      text,
      bounds: {
        requested: requestedBytes,
        limit,
        returned: Buffer.byteLength(text, "utf8"),
        truncated: false,
      },
      byteCount,
    };
  }

  const boundedLines: BlockLine[] = [];
  let used = 0;

  for (const line of lines) {
    const prefix = boundedLines.length > 0 ? "\n" : "";
    const size = Buffer.byteLength(`${prefix}${line.text}`, "utf8");
    if (used + size > limit) {
      break;
    }
    boundedLines.push(line);
    used += size;
  }

  const text = boundedLines.map((line) => line.text).join("\n");
  return {
    lines: boundedLines,
    text,
    bounds: {
      requested: requestedBytes,
      limit,
      returned: Buffer.byteLength(text, "utf8"),
      truncated: boundedLines.length !== lines.length,
    },
    byteCount,
  };
}

export function buildBlockContentHints(options: {
  layer: ProvenanceContentLayer;
  selectedLayer: LocalFileLayerState;
  window: ResolvedBlockWindow;
  bounds: ProvenanceBounds;
  byteCount: number;
}): string[] {
  const hints = buildContentHints({
    layer: options.layer,
    selectedLayer: options.selectedLayer,
    bounds: options.bounds,
    byteCount: options.byteCount,
  });

  if (options.window.clamped) {
    hints.push(
      `Requested context window was clamped to available lines ${options.window.startLine}-${options.window.endLine}.`,
    );
  }

  return hints;
}

export function createBlockContentWarnings(
  content: ProvBlockContent,
): ProvenanceWarning[] {
  const warnings = createContentWarning({
    layer: content.layer,
    ref: content.ref,
    path: content.path,
    exists: content.exists,
    text: content.text,
    bounds: content.bounds,
    byteCount: content.byteCount,
    hints: content.hints,
    confidence: content.confidence,
    detectionMethod: content.detectionMethod,
  });

  if (content.window.clamped) {
    warnings.push({
      code: "BLOCK_WINDOW_CLAMPED",
      message: `Requested block context was clamped to available lines ${content.window.startLine}-${content.window.endLine}.`,
      ambiguity: "low",
    });
  }

  return warnings;
}

export function buildBlockContentSource(
  content: ProvBlockContent,
): ProvenanceEvidenceSource {
  return {
    kind: "git",
    id: `content:${content.layer}`,
    ref: content.ref ?? content.layer,
    path: content.path,
    label: `${content.layer} block`,
    detail: content.exists
      ? `${content.window.startLine}-${content.window.endLine} (${content.lines.length} line(s))${content.bounds.truncated ? " (truncated)" : ""}`
      : "absent",
  };
}
