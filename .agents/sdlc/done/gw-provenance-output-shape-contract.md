# Groundwork provenance output shape contract

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-provenance-output-shape-contract

## Context

The CLI exercise follow-ups flagged that direct provenance state commands return direct local-state DTOs in the top-level CLI `data`, while registry-backed `gw_*` commands return nested provenance result envelopes. A breaking normalization is not necessary if the CLI advertises the distinction as an explicit machine-readable contract.

## Acceptance Criteria

- [x] AC-1: Decide and document whether direct provenance state commands keep direct DTO output or normalize to nested `gw_*` envelopes.
- [x] AC-2: `capabilities` exposes the provenance output shape distinction in a stable machine-readable field.
- [x] AC-3: Tests assert both direct state and registry-backed provenance commands advertise the correct output shape.
- [x] AC-4: Run targeted validation and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-cli-exercise-followups.md` AC-1.
[2026-05-06]: Decision: preserve compatibility. `provenance repo-state` and `provenance file-state` keep direct local-state DTOs in CLI `data`; registry-backed `provenance run` and direct `gw_*` commands advertise nested `provenance_result` output in CLI `data`.
[2026-05-06]: Added `output.data_shapes` and per-command `output_shape` fields to `capabilities`. Targeted validation passed: `bun run typecheck`; `bun run test src/tests/cli.test.ts -t "deterministic JSON capabilities" --reporter=verbose`; manual `bun ./src/cli.ts capabilities` smoke.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 235 tests plus build/import/dist CLI/local-install checks.
