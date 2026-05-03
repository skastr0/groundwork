# Groundwork session artifacts

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-session-artifacts

## Context

Codex hooks do not share OpenCode's in-memory session kernel. Groundwork needs durable local artifacts for cross-hook state such as overrides, skill confirmations, dedupe, pending snapshots, and traces.

## Acceptance Criteria

- [x] AC-1: Define `.groundwork/` artifact layout and schemas for session-scoped state.
- [x] AC-2: Store overrides, skill confirmations, action dedupe keys, pending tool snapshots, and provenance traces.
- [x] AC-3: Add retention/cleanup command for stale session artifacts.
- [x] AC-4: Make artifact access safe under repeated hook invocations.
- [x] AC-5: Document privacy/security implications of local trace storage.

## Notes

[2026-05-03]: Needed because Codex has no OpenCode `session.deleted` event or plugin session kernel.
[2026-05-03]: Added `src/session/artifacts.ts` and `src/session/index.ts`. Durable layout is `.groundwork/sessions/<session-id>/{state.json,events.jsonl,traces.jsonl}` with schema version `groundwork-session-artifacts/v1`. State writes use temp-file plus rename; event/trace logs are append-only JSONL.
[2026-05-03]: Added CLI commands: `session get`, `skill-loaded`, `override`, `remember-action`, `put-pending-tool`, `append-trace`, and `cleanup`. Commands use strict JSON schemas and are exposed through capabilities, schema discovery, and examples.
[2026-05-03]: Added workflow test in `src/tests/cli.test.ts` covering skill confirmations, overrides, action dedupe duplicate detection, pending tool snapshots, trace append, raw event/trace files, and session cleanup.
[2026-05-03]: Documented layout, commands, privacy implications, and retention in `docs/session-artifacts.md`. Added `.groundwork/` to `.gitignore`.
[2026-05-03]: Reviewer found session id directory collisions, non-serialized read-modify-write updates, and cleanup reporting missing sessions as removed. Fixed directory names to use sanitized display id plus SHA-256 hash prefix, added per-session lock files around mutating state commands, made cleanup check for an existing directory before removal, and added tests for colliding ids, missing cleanup, and concurrent mutations.
[2026-05-03]: Re-review PASS. Reviewer confirmed collision prevention, serialized mutations, missing cleanup behavior, docs, targeted CLI tests, and full verification.
