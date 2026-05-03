# Groundwork Codex hook scripts

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-codex-hook-scripts

## Context

Codex hooks should call the Groundwork CLI for best-effort guardrails and evidence capture. Hook claims must stay inside the current Codex contract: supported tool interception, trusted project loading, and known fail-open fields.

## Acceptance Criteria

- [ ] AC-1: Add hook scripts for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop` where supported.
- [ ] AC-2: `PreToolUse` invokes CLI risk/policy checks for supported tool calls and denies only when Codex supports denial.
- [ ] AC-3: `PostToolUse` records/report feedback without claiming side-effect prevention.
- [ ] AC-4: Tests cover supported denial, unsupported tool limitations, and JSON hook payload failures.
- [ ] AC-5: Documentation explicitly states tool-triggered prompt injection is unsupported in V1.

## Notes

[2026-05-03]: Split from `gw-ambient-parity-matrix` review findings.
