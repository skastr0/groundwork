# Groundwork policy blocked pending tools

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-blocked-pending-tools

## Context

The CLI surface exercise found that blocked `policy evaluate-tool-call` results can still create pending tool snapshots for mutating tools. That makes `policy evaluate-tool-result` appear to have a valid post-tool snapshot for a call that Groundwork already blocked.

## Acceptance Criteria

- [x] AC-1: Blocked pre-tool policy evaluations do not persist pending tool snapshots.
- [x] AC-2: Allowed or warn-only mutating pre-tool evaluations still persist pending snapshots for post-tool evaluation.
- [x] AC-3: CLI tests prove blocked calls return the no-pending-snapshot result on `policy evaluate-tool-result`.
- [x] AC-4: Run targeted tests and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Started from `.agents/sdlc/backlog/gw-cli-exercise-followups.md` AC-4.
[2026-05-06]: Changed `evaluatePolicyToolCall` to compute the decision before storing pending tool state, and to skip pending snapshots when the decision is `block`. Existing allowed post-tool path still proves snapshots are retained for allowed mutating calls. Targeted validation: `bun run typecheck`; `bun run test src/tests/cli.test.ts -t "policy override locks and post-tool result" --reporter=verbose`.
[2026-05-06]: Added explicit warn-only pre-tool coverage: a warning policy on `src/warn.ts` returns `warn`, then `policy evaluate-tool-result` consumes a real pending snapshot instead of returning the no-pending-snapshot result.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 233 tests plus build/import/dist CLI/local-install checks.
