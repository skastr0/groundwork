# Groundwork read tool refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-read-tool-refactor

## Context

`taste score --signal TS-LD-02 .` currently reports `src/provenance/tooling/query/index.ts` `executeReadTool` as the top function-size/local-reasoning hotspot at 155 LOC. The function mixes mode/path validation, repo/file state loading, content extraction, evidence loading, DTO assembly, warning/source assembly, and response logging.

## Acceptance Criteria

- [x] AC-1: Split `executeReadTool` into focused helpers without changing `gw_read` args or output shape.
- [x] AC-2: Preserve read provenance behavior with targeted query and CLI tests.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `executeReadTool` is no longer the top TS-LD-02 outlier.
- [x] AC-4: Run targeted validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current `taste score --signal TS-LD-02 .` output after the state-tool refactor. Current top diagnostic is `executeReadTool` at 155 LOC.
[2026-05-06]: Extracted read path failure formatting, repo/file state loading, selected layer content DTO assembly, evidence loading, read DTO assembly, and success response assembly. `executeReadTool` now orchestrates those helpers.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-query-tools.test.ts --reporter=verbose`; `bun run test src/tests/cli.test.ts -t "runs arbitrary gw_|matches representative OpenCode" --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `executeReadTool`; current top function outlier is `createFrameworkPolicyLayer` at 152 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 240 tests plus build/import/dist CLI/local-install checks.
