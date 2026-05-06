# Groundwork hotspots tool refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-hotspots-tool-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/tooling/score/index.ts` `createHotspotsTool` as the top function-size/local-reasoning hotspot at 118 LOC. The function mixes tool declaration, mode validation, start/end logging, hotspot execution, history confidence inference, warning assembly, source assembly, response serialization, and failure envelope creation.

## Acceptance Criteria

- [x] AC-1: Split `createHotspotsTool` into focused builder, execution, unsupported-mode, logging, warning/source assembly, success serialization, history DTO, and failure helpers.
- [x] AC-2: Preserve unsupported remote/hybrid mode behavior, history truncation and empty-history warnings, repo ambiguity warnings, source IDs, confidence/ambiguity inference, summary text, start/end/error logging, and failure envelope shape.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `createHotspotsTool` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted score/CLI validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `42f3dce`; top diagnostic is `createHotspotsTool` at 118 LOC.
[2026-05-06]: Split `gw_hotspots` into execution, unsupported-mode, start/end logging, warning/source assembly, confidence inference, history DTO, success serialization, and failure helpers. Added direct tests for unsupported hotspots mode and execution failure envelopes. Targeted `bun run typecheck`, `bun run test src/tests/provenance-score-tools.test.ts --reporter=verbose`, `bun run test src/tests/cli.test.ts -t "representative OpenCode provenance registry outputs" --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; taste no longer lists `createHotspotsTool`.
[2026-05-06]: Full `bun run verify` passed with 27 files / 259 tests plus build/import/CLI/local-install checks.
