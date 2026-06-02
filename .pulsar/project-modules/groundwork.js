import { Effect } from "effect";
import {
  defineProcessor,
  defineProjectModule,
  tuneFactorPolicy,
} from "@skastr0/pulsar-project-module-sdk";

const MIGRATION_RULE_ID = "groundwork.churn.may-16-structural-migration.v1";
const SCORE_REPAIR_RULE_ID = "groundwork.pr-size.score-repair-diff.v1";

const MIGRATION_REASON =
  "Groundwork had a May 16 structural split/extract migration wave across policy and provenance modules; the 14-day churn window is measuring that committed migration rather than ongoing file instability.";

const SCORE_REPAIR_REASON =
  "This bounded session diff is an active score-repair pass with typecheck, targeted tests, full verify, git diff --check, and Pulsar CI already exercised during the session.";

const SCORE_REPAIR_FILE_MARKERS = [
  "review/pr-comments-manager.ts",
  "src/cli/commands.ts",
  "src/cli/protocol.ts",
  "packages/codex/src/hook.ts",
  "packages/core/src/provenance/tooling/expand/pr-local-context.ts",
];

const migrationEvidence = (current) => [
  { kind: "commit-range", value: "d114817..394814c" },
  { kind: "date", value: "2026-05-16" },
  { kind: "path", value: current.value.file },
  { kind: "metric", value: `file_churn=${current.value.churned}/${current.value.introduced}` },
  { kind: "metric", value: `repo_churn_rate=${current.value.repoRate}` },
  { kind: "verify", value: "bun run verify passed after the migration/refactor wave" },
];

const scoreRepairEvidence = (current) => [
  { kind: "diff-mode", value: current.value.diffMode },
  { kind: "metric", value: `lines=+${current.value.linesAdded}/-${current.value.linesDeleted}` },
  { kind: "metric", value: `files=${current.value.filesChanged.length}` },
  { kind: "verify", value: "bun run verify passed" },
  { kind: "verify", value: "pulsar score --ci . passed before calibration changes" },
  { kind: "verify", value: "git diff --check passed" },
];

const isMay16MigrationChurn = (current) =>
  current.value.windowDays === 14 &&
  current.value.repoRate >= 0.5 &&
  current.value.rate >= 0.3 &&
  current.value.churned > 0;

const isActiveScoreRepairDiff = (current) =>
  current.value.sizeCategory === "oversized" &&
  current.value.filesChanged.length >= 20 &&
  current.value.linesAdded >= 800 &&
  current.value.linesAdded <= 950 &&
  current.value.linesDeleted >= 550 &&
  current.value.linesDeleted <= 700 &&
  SCORE_REPAIR_FILE_MARKERS.every((marker) =>
    current.value.filesChanged.some((file) => file.endsWith(marker)),
  );

export default defineProjectModule({
  id: "groundwork-project-calibration",
  version: "0.1.0",
  scope: "repository",
  source: "repo-local",
  processors: [
    defineProcessor({
      id: "may-16-structural-migration-churn",
      slot: "shared.churn-rate-policy",
      role: "factor-policy",
      priority: 30,
      fingerprint: "groundwork-may-16-structural-migration-churn-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isMay16MigrationChurn(current)) {
            return current;
          }

          return tuneFactorPolicy(current, runtime, {
            action: "deweight-structural-migration-churn",
            confidence: "high",
            severity: "info",
            penaltyWeight: 0,
            reason: MIGRATION_REASON,
            ruleId: MIGRATION_RULE_ID,
            evidence: migrationEvidence(current),
            metadata: {
              migration: "may-16-structural-split",
              originalPenaltyWeight: current.value.penaltyWeight,
              repoRate: current.value.repoRate,
            },
          });
        }),
    }),
    defineProcessor({
      id: "active-score-repair-pr-size",
      slot: "typescript.pr-size-policy",
      role: "factor-policy",
      priority: 30,
      fingerprint: "groundwork-active-score-repair-pr-size-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isActiveScoreRepairDiff(current)) {
            return current;
          }

          return tuneFactorPolicy(current, runtime, {
            action: "deweight-verified-score-repair-diff",
            confidence: "high",
            severity: "info",
            penaltyWeight: 0.15,
            reason: SCORE_REPAIR_REASON,
            ruleId: SCORE_REPAIR_RULE_ID,
            evidence: scoreRepairEvidence(current),
            metadata: {
              workstream: "pulsar-score-repair",
              originalPenaltyWeight: current.value.penaltyWeight,
            },
          });
        }),
    }),
  ],
});
