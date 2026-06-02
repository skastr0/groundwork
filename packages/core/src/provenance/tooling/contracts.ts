import { z, type ZodTypeAny } from "zod";

export type ProvenanceToolName = `gw_${string}`;

export const PROVENANCE_MODE_VALUES = ["local", "remote", "hybrid"] as const;
export const ProvenanceModeSchema = z.enum(PROVENANCE_MODE_VALUES);
export type ProvenanceMode = (typeof PROVENANCE_MODE_VALUES)[number];

export const PROVENANCE_CONFIDENCE_VALUES = ["high", "medium", "low", "unknown"] as const;
export const ProvenanceConfidenceSchema = z.enum(PROVENANCE_CONFIDENCE_VALUES);
export type ProvenanceConfidence = (typeof PROVENANCE_CONFIDENCE_VALUES)[number];

export const PROVENANCE_AMBIGUITY_VALUES = ["none", "low", "medium", "high"] as const;
export const ProvenanceAmbiguitySchema = z.enum(PROVENANCE_AMBIGUITY_VALUES);
export type ProvenanceAmbiguity = (typeof PROVENANCE_AMBIGUITY_VALUES)[number];

export const PROVENANCE_SOURCE_KIND_VALUES = [
  "git",
  "message",
  "session",
  "review",
  "derived",
] as const;
export const ProvenanceSourceKindSchema = z.enum(PROVENANCE_SOURCE_KIND_VALUES);
export type ProvenanceSourceKind = (typeof PROVENANCE_SOURCE_KIND_VALUES)[number];

export const ProvenanceEvidenceSourceSchema = z.object({
  kind: ProvenanceSourceKindSchema,
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  detail: z.string().min(1).optional(),
});
export interface ProvenanceEvidenceSource {
  kind: ProvenanceSourceKind;
  id: string;
  label?: string;
  path?: string;
  ref?: string;
  detail?: string;
}

export const ProvenanceWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  ambiguity: ProvenanceAmbiguitySchema.optional(),
});
export interface ProvenanceWarning {
  code: string;
  message: string;
  ambiguity?: ProvenanceAmbiguity;
}

export const ProvenanceBoundsSchema = z.object({
  requested: z.number().int().positive().optional(),
  limit: z.number().int().positive(),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export interface ProvenanceBounds {
  requested?: number;
  limit: number;
  returned: number;
  truncated: boolean;
}

export const ProvenanceMetaSchema = z.object({
  tool: z.string().regex(/^gw_[a-z0-9_]+$/),
  mode: ProvenanceModeSchema,
  confidence: ProvenanceConfidenceSchema,
  ambiguity: ProvenanceAmbiguitySchema,
  bounds: ProvenanceBoundsSchema.optional(),
  warnings: z.array(ProvenanceWarningSchema).default([]),
});
export interface ProvenanceMeta {
  tool: ProvenanceToolName;
  mode: ProvenanceMode;
  confidence: ProvenanceConfidence;
  ambiguity: ProvenanceAmbiguity;
  bounds?: ProvenanceBounds;
  warnings: ProvenanceWarning[];
}

export const ProvenanceErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
});
export interface ProvenanceError {
  code: string;
  message: string;
  retryable?: boolean;
}

export function createProvenanceSuccessSchema<TDataSchema extends ZodTypeAny>(
  dataSchema: TDataSchema,
) {
  return z.object({
    ok: z.literal(true),
    summary: z.string().optional(),
    meta: ProvenanceMetaSchema,
    sources: z.array(ProvenanceEvidenceSourceSchema).default([]),
    data: dataSchema,
  });
}

export const ProvenanceFailureSchema = z.object({
  ok: z.literal(false),
  summary: z.string().optional(),
  meta: ProvenanceMetaSchema,
  sources: z.array(ProvenanceEvidenceSourceSchema).default([]),
  error: ProvenanceErrorSchema,
});

export function createProvenanceResultSchema<TDataSchema extends ZodTypeAny>(
  dataSchema: TDataSchema,
) {
  return z.discriminatedUnion("ok", [
    createProvenanceSuccessSchema(dataSchema),
    ProvenanceFailureSchema,
  ]);
}

export type ProvenanceSuccess<TData> = {
  ok: true;
  summary?: string;
  meta: ProvenanceMeta;
  sources: ProvenanceEvidenceSource[];
  data: TData;
};

export type ProvenanceFailure = {
  ok: false;
  summary?: string;
  meta: ProvenanceMeta;
  sources: ProvenanceEvidenceSource[];
  error: ProvenanceError;
};

export type ProvenanceResult<TData> = ProvenanceSuccess<TData> | ProvenanceFailure;

type ProvenanceMetaInput = {
  tool: ProvenanceToolName;
  mode: ProvenanceMode;
  confidence: ProvenanceConfidence;
  ambiguity: ProvenanceAmbiguity;
  bounds?: ProvenanceBounds;
  warnings?: ProvenanceWarning[];
};

export function createProvenanceMeta(input: ProvenanceMetaInput): ProvenanceMeta {
  return {
    ...input,
    warnings: input.warnings ?? [],
  };
}

export function createProvenanceSuccess<TData>(
  input: ProvenanceMetaInput & {
    data: TData;
    summary?: string;
    sources?: ProvenanceEvidenceSource[];
  },
): ProvenanceSuccess<TData> {
  const { data, summary, sources, ...metaInput } = input;

  return {
    ok: true,
    summary,
    meta: createProvenanceMeta(metaInput),
    sources: sources ?? [],
    data,
  };
}

export function createProvenanceFailure(
  input: ProvenanceMetaInput & {
    error: ProvenanceError;
    summary?: string;
    sources?: ProvenanceEvidenceSource[];
  },
): ProvenanceFailure {
  const { error, summary, sources, ...metaInput } = input;

  return {
    ok: false,
    summary,
    meta: createProvenanceMeta(metaInput),
    sources: sources ?? [],
    error,
  };
}
