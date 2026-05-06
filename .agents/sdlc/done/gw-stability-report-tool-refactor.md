# Groundwork stability report tool refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-stability-report-tool-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/tooling/score/index.ts` `createStabilityReportTool` as the top function-size/local-reasoning hotspot at 133 LOC. The function mixes tool registration, mode validation, start/end logging, stability execution, warning assembly, source assembly, confidence/ambiguity inference, success response serialization, and failure envelope creation.

## Acceptance Criteria

- [x] AC-1: Split `createStabilityReportTool` into focused tool builder/execution helpers without changing `gw_stability_report` args or output shape.
- [x] AC-2: Preserve unsupported mode behavior, start/end/failure logging, warning/source assembly, confidence and ambiguity inference, success responses, and failure envelopes.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `createStabilityReportTool` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted score/provenance validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `429de88`; top diagnostic is `createStabilityReportTool` at 133 LOC.
[2026-05-06]: Split `gw_stability_report` into execution, unsupported-mode failure, start/end/failure logging, success serialization, warning assembly, source assembly, confidence inference, and history summary helpers.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `createStabilityReportTool`; current top function outlier is `fetchCommentStatesViaGraphQL` at 128 LOC.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose` (5 tests); `bun run test src/tests/provenance-score-tools.test.ts src/tests/cli.test.ts -t "score tools|stability report|gw_stability|representative OpenCode provenance" --reporter=verbose` (6 tests).
[2026-05-06]: Full validation passed: `bun run verify` completed 26 files / 250 tests plus build/import/dist CLI/local-install checks.
