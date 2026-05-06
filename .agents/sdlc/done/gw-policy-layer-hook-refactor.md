# Groundwork policy layer hook refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-layer-hook-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/policy/runtime.ts` `createFrameworkPolicyLayer` as the top function-size/local-reasoning hotspot at 152 LOC. The function mixes config loading/logging, layer registration assembly, chat policy command handling, before-tool evaluation, after-tool evaluation, pending tool snapshots, and session cleanup hooks.

This touches `src/policy/**`, so Groundwork readiness applies and an SDLC work item is required before implementation.

## Acceptance Criteria

- [x] AC-1: Split `createFrameworkPolicyLayer` into focused policy hook helpers without changing the returned layer registration surface.
- [x] AC-2: Preserve policy runtime behavior for prompt injection, skill confirmations, human overrides, pre-tool blocks, post-tool checks, pending tool snapshots, and session cleanup.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `createFrameworkPolicyLayer` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted policy validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `41345d2`; top diagnostic is `createFrameworkPolicyLayer` at 152 LOC.
[2026-05-06]: Extracted `createPolicyLayerHooks`, chat command handling, before/after tool handlers, policy command application, and event cleanup behind a shared policy runtime context. `createFrameworkPolicyLayer` now focuses on loading config, logging status, and returning the registration.
[2026-05-06]: Added policy runtime regression coverage for `session.deleted` cleanup clearing pending human-override locks.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/policy-runtime.test.ts --reporter=verbose`; `bun run test src/tests/index.test.ts src/tests/layer-dispatcher.test.ts src/tests/policy-runtime.test.ts --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `createFrameworkPolicyLayer`; current top function outlier is `loadLocalSpanTraceEvidence` at 141 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 241 tests plus build/import/dist CLI/local-install checks.
