# Groundwork score history loader refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-score-history-loader-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/tooling/score/index.ts` `loadHistory` as the remaining function-size/local-reasoning hotspot at 109 LOC. The function mixes option bounding, HEAD anchor loading, unavailable-head DTO assembly, git rev-list/log execution, warning creation, and final history DTO assembly.

## Acceptance Criteria

- [x] AC-1: Split `loadHistory` into focused helpers for history options, HEAD anchor loading, unavailable-head results, git history command loading, warning creation, bounds, and final DTO assembly.
- [x] AC-2: Preserve hotspots/authority/stability score behavior for normal, empty, truncated, and unavailable history.
- [x] AC-3: Run targeted score tests and confirm `taste score --signal TS-LD-02 .` no longer lists `loadHistory`.
- [x] AC-4: Run appropriate verification and commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output at `3f05ed3`; top function diagnostic is `loadHistory` at 109 LOC.
[2026-05-06]: Split `loadHistory` into load-option, HEAD-anchor, unavailable-head, raw-history, warning, bounds, and DTO helpers. Added unavailable HEAD-anchor coverage. `bun run typecheck`, `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; taste no longer lists `loadHistory`.
[2026-05-06]: Full `bun run verify` passed with 27 files / 272 tests plus build/import/CLI/local-install checks.
[2026-05-06]: Addressed consolidation review by removing the dropped `LoadedHistory.warnings` channel and routing hotspots, authority, and stability through one public `createHistoryWarnings` helper. Targeted `bun run typecheck` and `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose` passed.
[2026-05-06]: Addressed verification review by asserting unavailable HEAD history short-circuits before rev-list/log history commands and by adding direct history command failure coverage. Targeted `bun run typecheck`, `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed.
