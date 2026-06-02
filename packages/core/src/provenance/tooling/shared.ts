import {
  createProvenanceFailure,
  type ProvenanceAmbiguity,
  type ProvenanceConfidence,
  type ProvenanceEvidenceSource,
  type ProvenanceToolName,
  type ProvenanceWarning,
} from "./contracts.ts";

const CONFIDENCE_PRIORITY: Record<ProvenanceConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const AMBIGUITY_PRIORITY: Record<ProvenanceAmbiguity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getLowestConfidence(
  confidences: readonly ProvenanceConfidence[],
): ProvenanceConfidence {
  let lowest: ProvenanceConfidence = "high";

  for (const confidence of confidences) {
    if (CONFIDENCE_PRIORITY[confidence] < CONFIDENCE_PRIORITY[lowest]) {
      lowest = confidence;
    }
  }

  return lowest;
}

export function getHighestConfidence(
  confidences: readonly ProvenanceConfidence[],
): ProvenanceConfidence {
  let highest: ProvenanceConfidence = "unknown";

  for (const confidence of confidences) {
    if (CONFIDENCE_PRIORITY[confidence] > CONFIDENCE_PRIORITY[highest]) {
      highest = confidence;
    }
  }

  return highest;
}

export function getHighestAmbiguity(levels: readonly ProvenanceAmbiguity[]): ProvenanceAmbiguity {
  let highest: ProvenanceAmbiguity = "none";

  for (const level of levels) {
    if (AMBIGUITY_PRIORITY[level] > AMBIGUITY_PRIORITY[highest]) {
      highest = level;
    }
  }

  return highest;
}

export function dedupeWarnings(warnings: readonly ProvenanceWarning[]): ProvenanceWarning[] {
  const seen = new Set<string>();
  const output: ProvenanceWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(warning);
  }

  return output;
}

export function dedupeSources(
  sources: readonly ProvenanceEvidenceSource[],
): ProvenanceEvidenceSource[] {
  const seen = new Set<string>();
  const output: ProvenanceEvidenceSource[] = [];

  for (const source of sources) {
    const key = `${source.kind}:${source.id}:${source.path ?? ""}:${source.ref ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(source);
  }

  return output;
}

export function createLocalToolFailure(options: {
  tool: ProvenanceToolName;
  summary: string;
  code: string;
  message: string;
}): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: options.tool,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: options.summary,
      error: {
        code: options.code,
        message: options.message,
      },
    }),
    null,
    2,
  );
}

export function createUnsupportedModeFailure(toolName: ProvenanceToolName, mode: string): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: toolName,
      mode: mode as "remote" | "hybrid",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Unsupported provenance mode '${mode}' for ${toolName}.`,
      error: {
        code: "MODE_NOT_SUPPORTED",
        message: `${toolName} currently supports only local mode.`,
      },
    }),
    null,
    2,
  );
}
