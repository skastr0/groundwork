# Groundwork Vitest CLI serialization

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-vitest-cli-serialization

## Context

`bun run verify` runs the full Vitest suite with file-level parallelism enabled by default. The CLI tests launch many subprocess-backed Groundwork commands and timed out under full-suite parallel pressure, while each timed-out case passed when isolated and the full suite passed with file parallelism disabled.

## Acceptance Criteria

- [x] AC-1: Configure the default Vitest run so subprocess-heavy CLI tests do not compete with other test files.
- [x] AC-2: Preserve the existing `bun run test` and `bun run verify` command surfaces.
- [x] AC-3: Verify the full test suite passes with serialized file execution.

## Notes

[2026-05-06]: Isolated reruns passed for the four CLI tests that timed out under default parallel full-suite execution. `bun run test -- --fileParallelism=false` passed with 27 files and 268 tests.
[2026-05-06]: Added `fileParallelism: false` to `vitest.config.ts`. `bun run verify` passed with 27 files / 268 tests plus build/import/CLI/local-install checks.
