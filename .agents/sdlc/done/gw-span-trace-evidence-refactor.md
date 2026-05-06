# Groundwork span trace evidence refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-span-trace-evidence-refactor

## Context

`taste score --signal TS-LD-02 .` now reports `src/provenance/local-evidence.ts` `loadLocalSpanTraceEvidence` as the top function-size/local-reasoning hotspot at 141 LOC. The function mixes unavailable-source envelope creation, bounded trace-file selection, trace JSONL scanning, warning collection, span candidate scoring, match-mode selection, and final DTO assembly.

The neighboring `loadTraceEvidence` path performs similar trace JSONL scanning and warning collection, so this slice should consolidate that shared trace-record scan instead of creating another parallel helper stack.

## Acceptance Criteria

- [x] AC-1: Split `loadLocalSpanTraceEvidence` into focused helpers and share canonical trace-record scanning with `loadTraceEvidence`.
- [x] AC-2: Preserve span trace evidence exact/heuristic behavior and general path trace evidence behavior.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `loadLocalSpanTraceEvidence` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted provenance evidence/lineage validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created after policy layer hook refactor. Current top diagnostic is `loadLocalSpanTraceEvidence` at 141 LOC.
[2026-05-06]: Extracted canonical trace JSONL entry selection and record matching helpers shared by span trace evidence and general path trace evidence. The shared matcher preserves both file-range matches and metadata-only observed tool matches.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-evidence.test.ts --reporter=verbose`; `bun run test src/tests/provenance-tree-tools.test.ts src/tests/provenance-query-tools.test.ts src/tests/provenance-evidence.test.ts --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `loadLocalSpanTraceEvidence`; current top function outlier is `createFrameworkContextLayer` at 137 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 241 tests plus build/import/dist CLI/local-install checks.
[2026-05-06]: Follow-up after later taste output at `bc6d16a`: split the remaining span trace evidence selection/source assembly logic into focused helpers, added explicit unavailable-source coverage, and kept this as the canonical work item instead of a second parallel done artifact. Targeted validation passed with `bun run typecheck`, `bun run test src/tests/provenance-evidence.test.ts --reporter=verbose`, `bun run test src/tests/provenance-lineage-tools.test.ts --reporter=verbose`, and `taste score --signal TS-LD-02 .`; full `bun run verify` passed with 27 files / 269 tests plus build/import/CLI/local-install checks.
[2026-05-06]: Addressed review findings by routing span-trace unavailable results through the canonical `unavailableSource` helper, removing the parallel follow-up done artifact, and adding coverage for mixed exact/heuristic selection, bounds truncation, invalid trace warnings, and lineage heuristic/no-match warnings. Targeted `bun run typecheck`, `bun run test src/tests/provenance-evidence.test.ts --reporter=verbose`, `bun run test src/tests/provenance-lineage-tools.test.ts --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed.
