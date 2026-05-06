# Groundwork state tool factory refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-state-tool-factory-refactor

## Context

`taste score --signal TS-LD-02 .` currently reports `src/provenance/tooling/state/index.ts` `createStateTools` as the top function-size/local-reasoning hotspot at 186 LOC. The function mixes two provenance tool builders and both execute bodies inline.

## Acceptance Criteria

- [x] AC-1: Split `createStateTools` into focused repo-state and file-state tool builders without changing tool IDs, args, or output shape.
- [x] AC-2: Preserve local provenance state behavior with targeted tests.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `createStateTools` is no longer the top TS-LD-02 outlier.
- [x] AC-4: Run targeted validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current `taste score --signal TS-LD-02 .` output after the stability-report refactor. Current top diagnostic is `createStateTools` at 186 LOC.
[2026-05-06]: Extracted `createRepoStateTool`, `executeRepoStateTool`, `createFileStateTool`, and `executeFileStateTool`; `createStateTools` now only wires tool IDs to builders.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-local-state.test.ts --reporter=verbose`; `bun run test src/tests/cli.test.ts -t "inspects local repository state|inspects local file state" --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `createStateTools`; current top function outlier is `executeReadTool` at 155 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 237 tests plus build/import/dist CLI/local-install checks.
