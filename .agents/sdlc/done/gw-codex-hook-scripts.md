# Groundwork Codex hook scripts

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-codex-hook-scripts

## Context

Codex hooks should call the Groundwork CLI for best-effort guardrails and evidence capture. Hook claims must stay inside the current Codex contract: supported tool interception, trusted project loading, and known fail-open fields.

## Acceptance Criteria

- [x] AC-1: Add hook scripts for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop` where supported.
- [x] AC-2: `PreToolUse` invokes CLI risk/policy checks for supported tool calls and denies only when Codex supports denial.
- [x] AC-3: `PostToolUse` records/report feedback without claiming side-effect prevention.
- [x] AC-4: Tests cover supported denial, unsupported tool limitations, and JSON hook payload failures.
- [x] AC-5: Documentation explicitly states tool-triggered prompt injection is unsupported in V1.

## Notes

[2026-05-03]: Split from `gw-ambient-parity-matrix` review findings.
[2026-05-03]: Expanded generated and bundled Codex hook config to SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, and Stop. All events share `groundwork codex hook`.
[2026-05-03]: `PreToolUse` now checks Bash risk first, then policy for supported Bash/apply_patch/Edit/Write payloads; blocks only through Codex `PreToolUse` deny output. `PermissionRequest` denies risky Bash approval requests. `UserPromptSubmit` records explicit `/policy override` and `/policy skill-loaded` commands to durable session artifacts. `PostToolUse` runs policy result checks and reports feedback with explicit side-effect caveat. `Stop` returns JSON success without forcing continuation.
[2026-05-03]: Updated `docs/codex-integration.md`, bundled `skills/groundwork/SKILL.md`, and generated skill markdown to state supported hooks, trust boundaries, post-tool limits, and that Codex V1 does not support tool-triggered synthetic prompt injection parity.
[2026-05-03]: Added CLI hook tests for generated event coverage, policy PreToolUse denial, UserPromptSubmit policy command capture, PermissionRequest risk denial, PostToolUse feedback, unsupported/no-config paths, and invalid JSON payloads. Verification: `bun run test src/tests/cli.test.ts` passed 37 tests; `bun run verify` passed 25 files / 194 tests plus build/import/CLI smoke.
[2026-05-03]: Reviewer Huygens found two behavior issues: post-tool warning results were escalated to `decision: "block"`, and Bash risk warn mode returned before policy evaluation. Fixed by keeping post-tool warning feedback non-blocking and allowing policy denial to override risk warn. Added regression tests for both interactions. Verification after fixes: `bun run test src/tests/cli.test.ts` passed 39 tests; `bun run verify` passed 25 files / 196 tests plus build/import/CLI smoke.
