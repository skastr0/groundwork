# Groundwork policy override semantics

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-override-semantics

## Context

The CLI exercise follow-ups flagged that `policy override` needs clearer semantics: one-shot lock clearing vs durable approval with scope/TTL. Current behavior records the override for audit and clears the pending override lock, but it does not create a durable scoped approval.

## Acceptance Criteria

- [x] AC-1: `policy override` output explicitly states its semantics: one-shot pending-lock clear, no durable approval, no TTL.
- [x] AC-2: Discovery/schema descriptions use the clarified semantics.
- [x] AC-3: Tests prove a new matching `require_human_override` policy call can block again after an override.
- [x] AC-4: Run targeted validation and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-cli-exercise-followups.md` AC-3.
[2026-05-06]: Added `policy override` response semantics: `one_shot_pending_lock_clear`, `durable_approval: false`, `ttl: null`, `scope: pending_override_lock`, plus whether a pending lock was cleared.
[2026-05-06]: Clarified policy override discovery/schema text and added a CLI regression test proving a new matching `require_human_override` call blocks again after override. Targeted validation passed: `bun run typecheck`; `bun run test src/tests/cli.test.ts -t "policy overrides as one-shot|discoverable help|schema|examples" --reporter=verbose`; manual `bun ./src/cli.ts schema show policy.override` smoke.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 236 tests plus build/import/dist CLI/local-install checks.
