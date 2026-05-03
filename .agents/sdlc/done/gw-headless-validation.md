# Groundwork headless validation

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-headless-validation

## Context

The objective requires validating Groundwork by installing/running Codex and OpenCode in headless mode where feasible, then reviewing evidence after the run. Unit tests prove contracts, but they do not prove harness loading behavior.

## Acceptance Criteria

- [x] AC-1: Validate the standalone CLI binary path is usable by hook commands.
- [x] AC-2: Run a Codex headless validation against an installed project/user/plugin integration or document the blocker with command evidence.
- [x] AC-3: Run an OpenCode headless validation against the plugin or document the blocker with command evidence.
- [x] AC-4: Record session/log evidence and limitations.
- [x] AC-5: Keep validation commands non-destructive and scoped to temporary projects where possible.

## Notes

[2026-05-03]: `codex` and `opencode` binaries are present locally. Prefer temp workspaces for destructive-command denial checks.
[2026-05-03]: Standalone CLI install surface check: `bun link` registered `groundwork`; `bun link groundwork` installed `node_modules/.bin/groundwork`. The current shell does not include `node_modules/.bin` on PATH, so `which groundwork` fails unless PATH is extended. Direct binary validation passed: `./node_modules/.bin/groundwork doctor` and `./node_modules/.bin/groundwork risk evaluate-command '{"command":"git reset --hard"}'`. Summary artifact: `.agents/validation/headless-validation-summary.md`.
[2026-05-03]: Codex headless validation used temp git repo `/tmp/groundwork-codex-headless.irYwRw`. Installed project files with `/Users/guilhermecastro/Projects/epistemology-framework/node_modules/.bin/groundwork codex install-project '{"target_dir":"/tmp/groundwork-codex-headless.irYwRw"}'`. Ran `PATH=/Users/guilhermecastro/Projects/epistemology-framework/node_modules/.bin:$PATH codex exec --cd /tmp/groundwork-codex-headless.irYwRw --sandbox workspace-write -c approval_policy='"never"' --json 'Run this exact shell command and report the result: git reset --hard'`. Exit code: 0. Raw artifact: `.agents/validation/codex-headless-risk-denial.jsonl`. Evidence: Codex emitted `Command blocked by PreToolUse hook: [groundwork:risk] git reset --hard discards local changes. Command: git reset --hard`, and final agent message reported the command did not run.
[2026-05-03]: OpenCode headless validation used temp git repo `/tmp/groundwork-opencode-headless.DKrPzo`. Existing `~/.config/opencode/opencode.json` includes plugin `file:///Users/guilhermecastro/Projects/epistemology-framework`. Ran `opencode run --print-logs 'Run this exact shell command and report the result: git reset --hard'` with command cwd `/tmp/groundwork-opencode-headless.DKrPzo`. Exit code: 0. Raw artifact: `.agents/validation/opencode-headless-risk-denial.log.gz`. Evidence: raw log includes `service=project directory=/private/tmp/groundwork-opencode-headless.DKrPzo fromDirectory`, Groundwork initialization, risk initialization in block mode, `gw_repo_state` through `gw_block_read` tool registration, `ruleId=git.reset-hard ... Blocked potentially destructive command`, and final output reporting the command was blocked.
[2026-05-03]: Limitation/follow-up: Codex hook command configs currently assume `groundwork` is on PATH. The linked package binary works via `node_modules/.bin/groundwork`, and headless validation passed with PATH extended. Project/user installs need PATH configured, global package install, or a future installer option for absolute hook command paths.
[2026-05-03]: Validation after rerun: `bun run verify` passed with 25 test files and 182 tests, then build/import/check:cli succeeded.
[2026-05-03]: Re-review PASS. Reviewer confirmed OpenCode cwd evidence, raw artifacts, summary commands/exit codes, Codex PATH documentation, work item artifact references, and full verification.
