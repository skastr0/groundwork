# Groundwork policy engine consolidation

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-engine-consolidation

## Context

Consolidation review of `f01115a` found that the framework policy runtime and JSON CLI policy service still maintain parallel rule-evaluation engines:

- `src/policy/runtime.ts`: OpenCode/framework hook adapter backed by in-memory `FrameworkSessionKernelState`.
- `src/policy/cli-service.ts`: JSON CLI/Codex hook adapter backed by persisted `.groundwork/sessions` artifacts.

The two adapters intentionally serve different external control boundaries today, but they duplicate rule matching, phase selection, action dispatch, target materialization, pending snapshot lifecycle, and violation artifact creation. That leaves room for drift in policy behavior.

## Acceptance Criteria

- [ ] AC-1: Extract a shared policy evaluation core for rule matching, phase applicability, action dispatch shape, target materialization, and pending snapshot invariants.
- [ ] AC-2: Keep only thin state adapters for framework in-memory state and CLI persisted session artifacts.
- [ ] AC-3: Remove duplicate fallback/compatibility behavior for malformed pending snapshots; both adapters must fail closed or use the canonical `FrameworkPendingToolCall` contract.
- [ ] AC-4: Preserve policy runtime and CLI behavior with paired tests for representative rules across both adapters.
- [ ] AC-5: Run `bun run verify` and a consolidation review before moving this work item to done.

## Notes

[2026-05-06]: Created from consolidation review of `f01115a`. Immediate hook-refactor follow-up removed `pending.toolName || tool` / `pending.toolName || input.tool || "unknown"` fallbacks; deeper shared evaluator extraction remains.
