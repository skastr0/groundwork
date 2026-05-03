# Groundwork context hook state

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-context-hook-state

## Context

OpenCode can inject context reminders after tool calls. Codex cannot reliably inject synthetic prompts from tool hooks, so context discovery needs explicit CLI state and best-effort hook feedback.

## Acceptance Criteria

- [ ] AC-1: Define context discovery dedupe state in `.groundwork/` artifacts.
- [ ] AC-2: Add hook-friendly context commands for touched-path discovery and reminder rendering.
- [ ] AC-3: Codex hooks report context feedback without claiming synthetic prompt parity.
- [ ] AC-4: Tests cover repeated touched paths and dedupe behavior.
- [ ] AC-5: Skills document when agents should call `groundwork context discover` explicitly.

## Notes

[2026-05-03]: Split from the ambient parity review to avoid overclaiming OpenCode `client.session.prompt` parity.
