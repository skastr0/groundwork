# Groundwork context layer hook refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-context-layer-hook-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/context/runtime.ts` `createFrameworkContextLayer` as the top function-size/local-reasoning hotspot at 137 LOC. The function mixes runtime initialization logging, layer registration assembly, before-tool pending capture, after-tool context discovery/injection, prompt context persistence, dedupe recording, and session cleanup.

## Acceptance Criteria

- [x] AC-1: Split `createFrameworkContextLayer` into focused context hook helpers without changing the returned layer registration surface.
- [x] AC-2: Preserve context injection behavior, prompt context reuse, dedupe behavior, bounded reminder text, pending snapshot handling, and session cleanup.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `createFrameworkContextLayer` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted context/layer validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `e52b8b0`; top diagnostic is `createFrameworkContextLayer` at 137 LOC.
[2026-05-06]: Extracted context hook assembly, before-tool pending capture, after-tool context handling, reminder injection, and session cleanup behind a shared runtime context.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/context-runtime.test.ts src/tests/index.test.ts src/tests/layer-dispatcher.test.ts --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `createFrameworkContextLayer`; current top function outlier is `createLineageTools` at 137 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 241 tests plus build/import/dist CLI/local-install checks.
