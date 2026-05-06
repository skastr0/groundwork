# Groundwork score schemas split

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-score-schemas-split

## Context

`taste score --signal TS-LD-02 .` no longer reports function-level score tooling hotspots, but still reports `src/provenance/tooling/score/index.ts` as a file outlier at roughly 2.5k LOC. The lowest-risk file-level split is to move score tool schemas and inferred DTO types into a sibling module while preserving the `score/index.ts` export surface.

## Acceptance Criteria

- [x] AC-1: Move score tool schema definitions and inferred DTO aliases from `score/index.ts` into a focused sibling module.
- [x] AC-2: Preserve all existing imports and public exports from `score/index.ts`.
- [x] AC-3: Run targeted score/CLI schema validation and confirm `taste score --signal TS-LD-02 .` reflects the reduced score index size.
- [x] AC-4: Run appropriate verification and commit the completed slice.

## Notes

[2026-05-06]: Created after `loadHistory` review closure. Current TS-LD-02 diagnostics are file outliers for `src/provenance/tooling/score/index.ts` and `src/policy/config.ts`.
[2026-05-06]: Moved score DTO schemas and inferred DTO aliases into `src/provenance/tooling/score/schemas.ts`, with `score/index.ts` re-exporting the public schemas. Targeted `bun run typecheck`, `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose`, `bun run test src/tests/cli.test.ts -t "schema|provenance|gw_hotspots|gw_authority|gw_stability_report" --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; score index remains a file outlier but dropped from roughly 2478 to 2299 LOC.
[2026-05-06]: Full `bun run verify` passed with 27 files / 273 tests plus build/import/CLI/local-install checks.
