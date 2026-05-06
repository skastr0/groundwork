# Groundwork policy runtime action refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-runtime-action-refactor

## Context

`taste score --signal TS-LD-02 .` flags `src/policy/runtime.ts` `executeAction` as a function-size/local-reasoning hotspot. The function mixes all policy action variants into one long branch chain.

## Acceptance Criteria

- [x] AC-1: Split `executeAction` into action-specific handlers without changing policy action behavior.
- [x] AC-2: Preserve runtime policy behavior with existing policy runtime tests.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` or equivalent evidence to confirm `executeAction` is no longer a TS-LD-02 outlier.
- [x] AC-4: Run targeted validation and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-taste-refactor-targets.md` candidate `src/policy/runtime.ts`: extract action-type handlers from `executeAction`.
[2026-05-06]: Extracted action-specific handlers for inject prompt, ensure skill loaded, work item requirement, block tool, human override, and stop session actions. `executeAction` is now a dispatch switch.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/policy-runtime.test.ts --reporter=verbose`.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `executeAction`; remaining policy-runtime outlier is `createFrameworkPolicyLayer` at 152 LOC.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 236 tests plus build/import/dist CLI/local-install checks.
