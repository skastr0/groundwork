# Groundwork span trace evidence selection refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-span-trace-evidence-selection-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/local-evidence.ts` `loadLocalSpanTraceEvidence` as a function-size/local-reasoning hotspot at 109 LOC. The function currently mixes anchor/source availability, trace record loading, exact versus heuristic item construction, ranking, match-mode selection, bounding, and response assembly.

## Acceptance Criteria

- [x] AC-1: Split `loadLocalSpanTraceEvidence` into focused helpers for unavailable source responses, candidate collection, common item fields, match-mode selection, and available source assembly.
- [x] AC-2: Preserve exact span matching, path-only heuristic matching, ranking, bounds, warning propagation, anchor aliases, and source/result shape.
- [x] AC-3: Run targeted provenance evidence tests and confirm `taste score --signal TS-LD-02 .` no longer lists `loadLocalSpanTraceEvidence`.
- [x] AC-4: Run appropriate verification and commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output at `bc6d16a`; top diagnostic is `loadLocalSpanTraceEvidence` at 109 LOC.
[2026-05-06]: Refactored span trace evidence loading into unavailable-result, item collection, common-field construction, selection, and source assembly helpers. Added explicit unavailable span trace evidence coverage. `bun run typecheck`, `bun run test src/tests/provenance-evidence.test.ts --reporter=verbose`, `bun run test src/tests/provenance-lineage-tools.test.ts --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; taste no longer lists `loadLocalSpanTraceEvidence`.
[2026-05-06]: Full `bun run verify` passed with 27 files / 269 tests plus build/import/CLI/local-install checks.
