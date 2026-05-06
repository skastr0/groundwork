# Groundwork lineage tool refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-lineage-tool-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/tooling/lineage/index.ts` `createLineageTools` as the top function-size/local-reasoning hotspot at 137 LOC. The function mixes registry assembly, `gw_span_history` args, mode validation, span validation, path normalization, local lineage execution, success response assembly, logging, and failure envelopes.

## Acceptance Criteria

- [x] AC-1: Split `createLineageTools` into focused lineage tool builder/execution helpers without changing `gw_span_history` args or output shape.
- [x] AC-2: Preserve mode errors, span range errors, path normalization errors, success responses, logging, and failure envelopes.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `createLineageTools` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted lineage/provenance validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `6aa79f1`; top diagnostic is `createLineageTools` at 137 LOC.
[2026-05-06]: Split `gw_span_history` into `createSpanHistoryTool`, `executeSpanHistoryTool`, validation failure helpers, start/success/failure logging helpers, and response serialization helpers.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `createLineageTools`; current top function outlier is `resolveRemoteContext` at 134 LOC.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-query-tools.test.ts src/tests/cli.test.ts -t "gw_span_history|block provenance|representative OpenCode provenance" --reporter=verbose`; `bun run test src/tests/provenance-query-tools.test.ts --reporter=verbose`.
[2026-05-06]: Full validation passed with this lineage patch in the working tree: `bun run verify` completed 25 files / 242 tests plus build/import/dist CLI/local-install checks.
