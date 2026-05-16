import type { ExplainableScore, ProvenanceScoreFactor, ProvenanceSignal } from "./schemas.ts";

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function toPercent(value: number): number {
  return round(clamp(value, 0, 1) * 100);
}

function dedupeSignals(signals: readonly ProvenanceSignal[]): ProvenanceSignal[] {
  const seen = new Set<string>();
  const output: ProvenanceSignal[] = [];

  for (const signal of signals) {
    const key = `${signal.key}:${String(signal.value)}:${signal.sourceIDs.join(",")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(signal);
  }

  return output;
}

export function createSignal(options: {
  key: string;
  label: string;
  value: string | number | boolean;
  sourceIDs: string[];
  unit?: string;
  detail?: string;
}): ProvenanceSignal {
  return {
    key: options.key,
    label: options.label,
    value: options.value,
    unit: options.unit,
    detail: options.detail,
    sourceIDs: options.sourceIDs,
  };
}

export function createScore(options: {
  key: string;
  label: string;
  formula: string;
  interpretation: string;
  factors: ProvenanceScoreFactor[];
}): ExplainableScore {
  const value = round(options.factors.reduce((sum, factor) => sum + factor.contribution, 0));
  return {
    key: options.key,
    label: options.label,
    value,
    scale: {
      min: 0,
      max: 100,
      unit: "points",
    },
    formula: options.formula,
    interpretation: options.interpretation,
    factors: options.factors,
    signals: dedupeSignals(options.factors.flatMap((factor) => factor.signals)),
  };
}

export function shareFactor(options: {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  numeratorLabel: string;
  denominatorLabel: string;
  weight: number;
  sourceIDs: string[];
  unit?: string;
  detail?: string;
}): ProvenanceScoreFactor {
  const ratio = options.denominator > 0 ? options.numerator / options.denominator : 0;
  const value = toPercent(ratio);
  const contribution = round(value * options.weight);

  return {
    key: options.key,
    label: options.label,
    weight: options.weight,
    value,
    contribution,
    explanation: `${options.label} uses ${options.numerator}/${options.denominator} observed signal(s).`,
    signals: [
      createSignal({
        key: `${options.key}_numerator`,
        label: options.numeratorLabel,
        value: options.numerator,
        unit: options.unit,
        detail: options.detail,
        sourceIDs: options.sourceIDs,
      }),
      createSignal({
        key: `${options.key}_denominator`,
        label: options.denominatorLabel,
        value: options.denominator,
        unit: options.unit,
        sourceIDs: options.sourceIDs,
      }),
    ],
  };
}

export function describeAuthority(score: number): string {
  if (score >= 70) {
    return "dominant recent authority";
  }
  if (score >= 45) {
    return "shared authority";
  }
  return "light recent authority";
}

export function describeOwnershipClarity(score: number): string {
  if (score >= 70) {
    return "changes are concentrated under one recent steward";
  }
  if (score >= 40) {
    return "ownership is shared across a few recent authors";
  }
  return "ownership is diffuse in the recent window";
}

export function describePressure(score: number, positiveLabel: string, neutralLabel: string): string {
  if (score >= 70) {
    return positiveLabel;
  }
  if (score >= 35) {
    return neutralLabel;
  }
  return "pressure is low";
}
