# Groundwork score tool factory refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-score-tool-factory-refactor

## Context

`taste score .` continues to flag `src/provenance/tooling/score/index.ts` `createScoreTools` as the top TS-LD-02 function-size/local-reasoning hotspot. The factory currently contains all three score tool execute bodies inline.

## Acceptance Criteria

- [x] AC-1: Split `createScoreTools` into narrow score tool builder helpers without changing tool IDs, args, or response shapes.
- [x] AC-2: Preserve score tool behavior with existing targeted score tool tests.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` or equivalent evidence to confirm `createScoreTools` is no longer the top outlier.
- [x] AC-4: Run targeted validation and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-taste-refactor-targets.md` candidate `src/provenance/tooling/score/index.ts`: extract common score-tool wrapper shape for hotspots, authority, and stability.
[2026-05-06]: Extracted `createHotspotsTool`, `createAuthorityTool`, and `createStabilityReportTool`; `createScoreTools` now only normalizes runtime options and wires tool IDs to builders.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `createScoreTools`; top remaining score-tool outlier is `executeStabilityReport` at 279 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 236 tests plus build/import/dist CLI/local-install checks.
