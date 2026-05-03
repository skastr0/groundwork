# Groundwork Codex hook command path

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-codex-hook-command-path

## Context

Headless validation proved Codex hooks work when `groundwork` is on `PATH`, but generated project/user hook configs currently assume that PATH setup. Installers should support an explicit hook command so local/project installs can point at a known binary path.

## Acceptance Criteria

- [x] AC-1: `groundwork codex install-project` accepts a hook command override.
- [x] AC-2: `groundwork codex install-user` accepts a hook command override.
- [x] AC-3: Generated `hooks.json` uses the override when provided and defaults to `groundwork codex hook`.
- [x] AC-4: Schemas, examples, and docs describe the hook command/path requirement.
- [x] AC-5: Tests cover default and explicit hook command installs.

## Notes

[2026-05-03]: Follow-up from `gw-headless-validation` PATH limitation.
[2026-05-03]: Added optional `hook_command` to project/user Codex installer input schemas and JSON schema contracts. Generated `hooks.json` uses the override when present and continues to default to `groundwork codex hook`.
[2026-05-03]: Updated examples and `docs/codex-integration.md` to explain PATH requirements and explicit hook command installs. Added CLI tests for project/user installs with explicit hook commands.
[2026-05-03]: Review PASS. Reviewer found no blocking issues; confirmed implementation, schemas, examples, install safety, and tests. Applied non-blocking doc wording polish so docs mention configured `hook_command`.
