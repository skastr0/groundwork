# Groundwork block read tool refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-block-read-tool-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/tooling/query/index.ts` `executeBlockReadTool` as the top function-size/local-reasoning hotspot at 111 LOC. The function mixes mode validation, path normalization failures, start logging, state loading, content resolution, lineage resolution, diff context, evidence loading, success serialization, and failure envelope/logging.

## Acceptance Criteria

- [x] AC-1: Split `executeBlockReadTool` into focused unsupported-mode, path normalization, state/content/context loading, success, and failure helpers without changing `gw_block_read` behavior.
- [x] AC-2: Preserve unsupported mode behavior, invalid path failure envelope, out-of-bounds/window validation, lineage/diff/evidence assembly, summary/meta/source shape, and start/end/error logging.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `executeBlockReadTool` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted query/CLI validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `09fa2ad`; top diagnostic is `executeBlockReadTool` at 111 LOC.
[2026-05-06]: Split block-read execution into unsupported-mode, path-normalization failure, success-input loading, and failure serialization helpers while preserving the original sequential lineage/diff/evidence order. Targeted `bun run typecheck`, `bun run test src/tests/provenance-query-tools.test.ts --reporter=verbose`, `bun run test src/tests/cli.test.ts -t "block-read|gw_block_read|provenance" --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; taste no longer lists `executeBlockReadTool`.
[2026-05-06]: Full `bun run verify` passed with 27 files / 264 tests plus build/import/CLI/local-install checks.
