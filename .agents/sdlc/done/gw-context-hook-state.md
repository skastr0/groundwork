# Groundwork context hook state

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-context-hook-state

## Context

OpenCode can inject context reminders after tool calls. Codex cannot reliably inject synthetic prompts from tool hooks, so context discovery needs explicit CLI state and best-effort hook feedback.

## Acceptance Criteria

- [x] AC-1: Define context discovery dedupe state in `.groundwork/` artifacts.
- [x] AC-2: Add hook-friendly context commands for touched-path discovery and reminder rendering.
- [x] AC-3: Codex hooks report context feedback without claiming synthetic prompt parity.
- [x] AC-4: Tests cover repeated touched paths and dedupe behavior.
- [x] AC-5: Skills document when agents should call `groundwork context discover` explicitly.

## Notes

[2026-05-03]: Split from the ambient parity review to avoid overclaiming OpenCode `client.session.prompt` parity.
[2026-05-03]: Added `groundwork context touched-paths` backed by durable session artifacts. It accepts hook-style args/targets, discovers inherited AGENTS.md/CLAUDE.md files, records dedupe keys in `.groundwork` session actions, and returns bounded reminder text only for newly seen context files.
[2026-05-03]: Codex `PostToolUse` now reports new context reminders as non-blocking feedback with explicit wording that this is not synthetic prompt injection parity. Repeated touched paths are deduped through session artifacts.
[2026-05-03]: Updated capabilities, schemas, examples, generated/bundled skill text, and Codex docs. Added tests for CLI touched-path dedupe and Codex PostToolUse context feedback/dedupe. Verification: `bun run test src/tests/cli.test.ts` passed 41 tests; `bun run verify` passed 25 files / 198 tests plus build/import/CLI smoke.
[2026-05-03]: Reviewer Gibbs found three issues: directory-only calls could write session dedupe under the wrong root, explicit targets bypassed normalization, and post-tool policy warnings suppressed context reminders. Fixed by resolving root from `root_dir ?? directory ?? cwd`, normalizing explicit targets through root/directory safety checks, and combining non-blocking policy warning feedback with context reminders. Added regression tests for directory-only dedupe, explicit absolute/unsafe targets, and policy-warning-plus-context output. Verification after fixes: `bun run test src/tests/cli.test.ts` passed 44 tests; `bun run verify` passed 25 files / 201 tests plus build/import/CLI smoke.
