# Groundwork policy action refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-action-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/policy/cli-service.ts` `executePolicyAction` as the top function-size/local-reasoning hotspot at 113 LOC. The function mixes action dispatch, inject prompt dedupe, skill confirmation/guidance, work-item checks, block-tool violations, human override locks, termination locks, and violation recording.

## Acceptance Criteria

- [x] AC-1: Split `executePolicyAction` into focused action handlers without changing policy CLI behavior.
- [x] AC-2: Preserve inject prompt dedupe, skill-gate guidance and strict-mode violations, work-item enforcement, block-tool messages, human override locks, termination locks, severity handling, and violation artifact recording.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `executePolicyAction` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted policy CLI/runtime validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `53c19f4`; top diagnostic is `executePolicyAction` at 113 LOC. Groundwork-readiness loaded before policy edits per repository guidance.
[2026-05-06]: Split policy action execution into one handler per action type. Targeted `bun run typecheck`, `bun run test src/tests/cli.test.ts -t "policy" --reporter=verbose`, `bun run test src/tests/policy-runtime.test.ts src/tests/index.test.ts --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; taste no longer lists `executePolicyAction`.
[2026-05-06]: Full `bun run verify` passed with 27 files / 260 tests plus build/import/CLI/local-install checks.
[2026-05-06]: Verification follow-up added CLI coverage for repeated `inject_prompt` dedupe and warn-only `require_human_override` violation artifacts without mutating-tool locks. Full `bun run verify` passed with 27 files / 262 tests plus build/import/CLI/local-install checks.
