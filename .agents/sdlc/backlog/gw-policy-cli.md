# Groundwork policy CLI

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-policy-cli

## Context

Policy behavior currently lives inside the OpenCode runtime. Codex and future thin wrappers need hook-friendly CLI commands for preflight checks, post-tool checks, override locks, and required-skill confirmations.

## Acceptance Criteria

- [ ] AC-1: Add `groundwork policy evaluate-tool-call` with strict JSON input/output schema.
- [ ] AC-2: Add `groundwork policy evaluate-tool-result` for post-mutation feedback.
- [ ] AC-3: Add `groundwork policy override` and `groundwork policy skill-loaded` commands backed by session artifacts.
- [ ] AC-4: Preserve blocking semantics for supported pre-tool policy violations.
- [ ] AC-5: Tests cover prompt-mode guidance, non-prompt enforcement, overrides, and required-skill confirmation state.

## Notes

[2026-05-03]: Required by Codex hook scripts and OpenCode thin wrapper work.
