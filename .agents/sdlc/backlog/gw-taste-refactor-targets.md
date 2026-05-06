# Groundwork taste refactor targets

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-taste-refactor-targets

## Context

The `taste` CLI scan found several local reasoning and function-size hotspots. These should be handled as focused refactor slices after correctness work, not mixed into unrelated CLI fixes.

## Acceptance Criteria

- [x] AC-1: Re-run `taste score .` and confirm the current top Groundwork quality findings.
- [x] AC-2: Choose one high-impact refactor target with a narrow write scope and measurable before/after shape.
- [x] AC-3: Preserve public CLI/provenance/policy behavior with targeted tests before and after the refactor.
- [ ] AC-4: Commit each refactor slice separately and review for simplicity/consolidation regressions.

## Candidate Findings

- `src/provenance/tooling/query/index.ts`: extract `gw_read` / `gw_block_read` handler builders and break down the large `gw_block_read` execution body.
- `src/provenance/tooling/score/index.ts`: extract common score-tool wrapper shape for hotspots, authority, and stability.
- `src/provenance/tooling/score/index.ts`: split `executeStabilityReport` into pending-path collection and score DTO assembly helpers.
- `src/policy/runtime.ts`: extract action-type handlers from `executeAction`.
- `src/policy/config.ts`: split matcher execution and changed-line snippet planning out of the large config module.

## Notes

[2026-05-06]: Sidecar scan used `taste score .` and `taste score --signal TS-LD-02 .`.
[2026-05-06]: Slice 1 targets `src/provenance/tooling/query/index.ts`. Before: `createQueryTools` 474 LOC and `gw_block_read` execute body 258 LOC. After extracting query tool factories and block-read assembly helpers, both dropped from TS-LD-02 diagnostics; residual query outlier is `executeReadTool` at 155 LOC. Targeted validation: `bun run typecheck`; `bun run test src/tests/provenance-query-tools.test.ts --reporter=verbose`; `bun run test src/tests/provenance-query-tools.test.ts src/tests/cli.test.ts -t "gw_read|gw_block_read|provenance" --reporter=verbose`; direct `bun ./src/cli.ts provenance block-read ...` smoke. Added representative `gw_block_read` payload coverage for block window/focus lines, range lineage, local diff overlap, and linked message evidence.
