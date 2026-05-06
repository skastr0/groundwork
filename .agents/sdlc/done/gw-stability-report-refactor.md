# Groundwork stability report refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-stability-report-refactor

## Context

`taste score --signal TS-LD-02 .` currently flags `src/provenance/tooling/score/index.ts` `executeStabilityReport` as the top function-size/local-reasoning hotspot at 279 LOC. The function mixes request normalization, repository/history/evidence loading, pending path collection, window aggregation, score assembly, DTO assembly, and output packaging.

## Acceptance Criteria

- [x] AC-1: Split `executeStabilityReport` into focused helpers without changing `gw_stability_report` output shape or behavior.
- [x] AC-2: Preserve score-tool behavior with focused provenance score tests.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `executeStabilityReport` is no longer the top TS-LD-02 outlier.
- [x] AC-4: Run targeted validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-taste-refactor-targets.md` candidate `src/provenance/tooling/score/index.ts`: split `executeStabilityReport` into pending-path collection and score DTO assembly helpers.
[2026-05-06]: Current evidence: `taste score --signal TS-LD-02 .` reports `executeStabilityReport` at 279 LOC as the top diagnostic.
[2026-05-06]: Extracted stability window resolution, history aggregation, pending path collection, component score builders, composite stability score assembly, and final DTO assembly. `executeStabilityReport` now orchestrates those helpers.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `executeStabilityReport`; current top function outlier is `createStateTools` at 186 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 237 tests plus build/import/dist CLI/local-install checks.
[2026-05-06]: Verification review follow-up: expanded `gw_stability_report` characterization coverage for empty history/no evidence with reversed windows and for untracked-only pending paths. Targeted score-tool validation now covers 5 tests.
