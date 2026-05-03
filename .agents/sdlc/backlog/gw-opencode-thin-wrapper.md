# Groundwork OpenCode thin wrapper

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-opencode-thin-wrapper

## Context

The current OpenCode plugin still owns significant business logic. The target architecture is CLI-first: OpenCode hooks and `gw_*` tools should become thin adapters over shared CLI/core behavior while preserving existing OpenCode runtime affordances where they are stronger than Codex.

## Acceptance Criteria

- [ ] AC-1: Identify current OpenCode plugin logic that should move behind CLI/core commands.
- [ ] AC-2: Refactor at least one foundation path so OpenCode calls the same CLI/core service as the CLI.
- [ ] AC-3: Preserve OpenCode tool IDs and hook behavior for the refactored path.
- [ ] AC-4: Add tests proving the wrapper and CLI produce compatible decisions/results.
- [ ] AC-5: Document remaining non-thin wrapper paths as follow-up items.

## Notes

[2026-05-03]: Prefer incremental refactors after the CLI foundation stabilizes.
