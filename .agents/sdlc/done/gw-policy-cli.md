# Groundwork policy CLI

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-cli

## Context

Policy behavior currently lives inside the OpenCode runtime. Codex and future thin wrappers need hook-friendly CLI commands for preflight checks, post-tool checks, override locks, and required-skill confirmations.

## Acceptance Criteria

- [x] AC-1: Add `groundwork policy evaluate-tool-call` with strict JSON input/output schema.
- [x] AC-2: Add `groundwork policy evaluate-tool-result` for post-mutation feedback.
- [x] AC-3: Add `groundwork policy override` and `groundwork policy skill-loaded` commands backed by session artifacts.
- [x] AC-4: Preserve blocking semantics for supported pre-tool policy violations.
- [x] AC-5: Tests cover prompt-mode guidance, non-prompt enforcement, overrides, and required-skill confirmation state.

## Notes

[2026-05-03]: Required by Codex hook scripts and OpenCode thin wrapper work.
[2026-05-03]: Added `src/policy/cli-service.ts` plus CLI command wiring, strict schemas, discovery/capability examples, and preflight command-shape support for `policy evaluate-tool-call`, `evaluate-tool-result`, `override`, and `skill-loaded`.
[2026-05-03]: Policy CLI state is backed by durable session artifacts: skill confirmations and override records use the session API, pending tool snapshots are persisted for post-result checks, and override acceptance clears the pending mutating-tool lock.
[2026-05-03]: Added CLI tests for prompt-mode `ensure_skill_loaded` guidance, block-mode skill enforcement and confirmation, human override locks, and post-tool changed-lines content feedback. Verification: `bun run test src/tests/cli.test.ts`; `bun run verify` passed 25 files / 189 tests plus build/import/CLI smoke.
[2026-05-03]: Reviewer Nash found three issues: policy override/unlock was split across two state writes, stale lock cleanup could break long-running live holders, and `knownTopLevelCommands()` omitted `policy`. Fixed by making policy override/unlock one durable state transaction, heartbeating active session locks, and adding `policy` to repair hints with CLI test coverage. Verification after fixes: `bun run test src/tests/cli.test.ts` passed 32 tests; `bun run verify` passed 25 files / 189 tests plus build/import/CLI smoke.
