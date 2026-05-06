# Groundwork local file state refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-local-file-state-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/tooling/state/local-state.ts` `resolveLocalFileState` as the top function-size/local-reasoning hotspot at 120 LOC. The function mixes repo-state resolution, three diff-layer reads, path-chain resolution, metadata reads, untracked-file diff synthesis, file-layer DTO assembly, comparison DTO assembly, worktree existence inference, and final response assembly.

## Acceptance Criteria

- [x] AC-1: Split `resolveLocalFileState` into focused helpers for diff entry loading, metadata loading, untracked worktree entry synthesis, file layer assembly, comparison assembly, worktree layer assembly, and final DTO assembly.
- [x] AC-2: Preserve rename-chain path resolution, untracked worktree-only behavior, base/head/index metadata mapping, comparison status mapping, ambiguity/confidence propagation, and direct CLI file-state behavior.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `resolveLocalFileState` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted local-state/file-state validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `5bfd7f0`; top diagnostic is `resolveLocalFileState` at 120 LOC.
[2026-05-06]: Split local file-state resolution into diff entry loading, metadata loading, untracked worktree entry synthesis, tracked-layer assembly, comparison assembly, worktree-layer assembly, and final DTO assembly helpers. Targeted `bun run typecheck`, `bun run test src/tests/provenance-local-state.test.ts --reporter=verbose`, `bun run test src/tests/cli.test.ts -t "local file state|file-state" --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; taste no longer lists `resolveLocalFileState`.
[2026-05-06]: Full `bun run verify` passed with 27 files / 257 tests plus build/import/CLI/local-install checks.
