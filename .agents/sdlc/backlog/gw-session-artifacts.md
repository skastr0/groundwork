# Groundwork session artifacts

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-session-artifacts

## Context

Codex hooks do not share OpenCode's in-memory session kernel. Groundwork needs durable local artifacts for cross-hook state such as overrides, skill confirmations, dedupe, pending snapshots, and traces.

## Acceptance Criteria

- [ ] AC-1: Define `.groundwork/` artifact layout and schemas for session-scoped state.
- [ ] AC-2: Store overrides, skill confirmations, action dedupe keys, pending tool snapshots, and provenance traces.
- [ ] AC-3: Add retention/cleanup command for stale session artifacts.
- [ ] AC-4: Make artifact access safe under repeated hook invocations.
- [ ] AC-5: Document privacy/security implications of local trace storage.

## Notes

[2026-05-03]: Needed because Codex has no OpenCode `session.deleted` event or plugin session kernel.
