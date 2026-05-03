# Groundwork compaction render

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-compaction-render

## Context

OpenCode has `experimental.session.compacting`; Codex does not currently expose a direct compaction context hook. Groundwork should provide an explicit render command and best-effort stop/review nudges instead of claiming parity.

## Acceptance Criteria

- [ ] AC-1: Add a CLI command that renders compact Groundwork session context from artifacts.
- [ ] AC-2: Include policy locks, skill confirmations, provenance trace summary, and context reminders where available.
- [ ] AC-3: Add Codex `Stop` hook guidance only where it can request continuation without pretending to alter compaction.
- [ ] AC-4: Tests cover empty and populated artifact stores.
- [ ] AC-5: Documentation states Codex compaction parity is unsupported in V1.

## Notes

[2026-05-03]: Depends on `gw-session-artifacts`.
