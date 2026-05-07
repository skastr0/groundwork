import { z } from "zod";
import {
  createProvenanceResultSchema,
  ProvenanceBoundsSchema,
} from "../contracts.ts";
import { ProvRepoStateDataSchema } from "../state/index.ts";

const ProvenanceSignalSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().min(1).optional(),
  detail: z.string().min(1).optional(),
  sourceIDs: z.array(z.string().min(1)).min(1),
});

const ProvenanceScoreFactorSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().min(0).max(1),
  value: z.number(),
  contribution: z.number(),
  explanation: z.string().min(1),
  signals: z.array(ProvenanceSignalSchema).min(1),
});

const ExplainableScoreSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  scale: z.object({
    min: z.number(),
    max: z.number(),
    unit: z.string().min(1),
  }),
  formula: z.string().min(1),
  interpretation: z.string().min(1),
  factors: z.array(ProvenanceScoreFactorSchema).min(1),
  signals: z.array(ProvenanceSignalSchema).min(1),
});

const AuthorSampleSchema = z.object({
  authorName: z.string().min(1),
  authorEmail: z.string().email(),
  commits: z.number().int().nonnegative(),
});

const HistorySummarySchema = z.object({
  headCommit: z.string().nullable(),
  headAuthoredAt: z.string().nullable(),
  headAuthoredAtMs: z.number().int().nonnegative(),
  oldestSince: z.string().nullable(),
  totalCommits: z.number().int().nonnegative(),
  loadedCommits: z.number().int().nonnegative(),
  bounds: ProvenanceBoundsSchema,
  detectionMethod: z.string().min(1),
});

const HotspotAnchorSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  groupBy: z.enum(["file", "directory"]),
  directoryDepth: z.number().int().positive(),
});

const HotspotItemSchema = z.object({
  path: z.string().min(1),
  commitCount: z.number().int().nonnegative(),
  uniqueAuthors: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
  lastTouchedAt: z.string().nullable(),
  sampleAuthors: z.array(AuthorSampleSchema),
  signals: z.array(ProvenanceSignalSchema).min(1),
});

const HotspotWindowSchema = z.object({
  days: z.number().int().positive(),
  since: z.string().min(1),
  until: z.string().min(1),
  commitCount: z.number().int().nonnegative(),
  touchedPaths: z.number().int().nonnegative(),
  highestChurn: z.array(HotspotItemSchema),
  mostActive: z.array(HotspotItemSchema),
  hints: z.array(z.string().min(1)),
});

export const ProvHotspotsDataSchema = z.object({
  anchor: HotspotAnchorSchema,
  repo: ProvRepoStateDataSchema,
  history: HistorySummarySchema,
  windows: z.array(HotspotWindowSchema),
});

export const ProvHotspotsResultSchema = createProvenanceResultSchema(ProvHotspotsDataSchema);

const AuthorityTotalsSchema = z.object({
  commits: z.number().int().nonnegative(),
  touchedPaths: z.number().int().nonnegative(),
  uniqueAuthors: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
});

const AuthorityAuthorSchema = z.object({
  authorName: z.string().min(1),
  authorEmail: z.string().email(),
  commits: z.number().int().nonnegative(),
  uniquePaths: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
  lastTouchedAt: z.string().nullable(),
  score: ExplainableScoreSchema,
});

export const ProvAuthorityDataSchema = z.object({
  anchor: z.object({
    requestedPath: z.string().min(1),
    resolvedPath: z.string().min(1),
  }),
  repo: ProvRepoStateDataSchema,
  history: HistorySummarySchema,
  window: z.object({
    days: z.number().int().positive(),
    since: z.string().min(1),
    until: z.string().min(1),
  }),
  totals: AuthorityTotalsSchema,
  leaders: z.array(AuthorityAuthorSchema),
});

export const ProvAuthorityResultSchema = createProvenanceResultSchema(ProvAuthorityDataSchema);

const StabilityAssessmentSchema = z.object({
  label: z.enum(["steady", "watch", "volatile"]),
  reasons: z.array(z.string().min(1)),
});

export const ProvStabilityReportDataSchema = z.object({
  anchor: z.object({
    requestedPath: z.string().min(1),
    resolvedPath: z.string().min(1),
  }),
  repo: ProvRepoStateDataSchema,
  history: HistorySummarySchema,
  windows: z.object({
    recent: z.object({
      days: z.number().int().positive(),
      since: z.string().min(1),
      until: z.string().min(1),
      commits: z.number().int().nonnegative(),
    }),
    baseline: z.object({
      days: z.number().int().positive(),
      since: z.string().min(1),
      until: z.string().min(1),
      commits: z.number().int().nonnegative(),
      touchedPaths: z.number().int().nonnegative(),
      uniqueAuthors: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      churn: z.number().int().nonnegative(),
      lastTouchedAt: z.string().nullable(),
    }),
  }),
  pending: z.object({
    staged: z.number().int().nonnegative(),
    unstaged: z.number().int().nonnegative(),
    untracked: z.number().int().nonnegative(),
    totalPaths: z.number().int().nonnegative(),
  }),
  scores: z.object({
    stability: ExplainableScoreSchema,
    ownershipClarity: ExplainableScoreSchema,
    recentChangePressure: ExplainableScoreSchema,
    pendingChangePressure: ExplainableScoreSchema,
  }),
  assessment: StabilityAssessmentSchema,
});

export const ProvStabilityReportResultSchema = createProvenanceResultSchema(
  ProvStabilityReportDataSchema,
);

export type ProvenanceSignal = z.infer<typeof ProvenanceSignalSchema>;
export type ProvenanceScoreFactor = z.infer<typeof ProvenanceScoreFactorSchema>;
export type ExplainableScore = z.infer<typeof ExplainableScoreSchema>;
export type HotspotItem = z.infer<typeof HotspotItemSchema>;
export type HotspotWindow = z.infer<typeof HotspotWindowSchema>;
export type HistorySummary = z.infer<typeof HistorySummarySchema>;
export type AuthorityAuthor = z.infer<typeof AuthorityAuthorSchema>;
export type AuthorSample = z.infer<typeof AuthorSampleSchema>;
export type AuthorityTotals = z.infer<typeof AuthorityTotalsSchema>;
export type StabilityAssessment = z.infer<typeof StabilityAssessmentSchema>;
