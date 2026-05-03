# Groundwork Codex integration

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-codex-integration

## Context

Groundwork needs a first-class Codex integration around the CLI. Codex should be able to use Groundwork through bundled skills, optional hooks, project/user configuration patching, and plugin packaging. Hooks must be treated as best-effort guardrails unless the current Codex contract proves stronger behavior for a specific event.

## Acceptance Criteria

- [x] AC-1: Add Codex plugin bundle with `.codex-plugin/plugin.json` and bundled Groundwork skills.
- [x] AC-2: Add Codex hook scripts/config that call the `groundwork` CLI for supported ambient guardrails.
- [x] AC-3: Add installer commands for project `.codex/`, user `$CODEX_HOME`, and plugin/marketplace installation modes.
- [x] AC-4: `groundwork codex doctor` verifies active config/hook/plugin readiness.
- [x] AC-5: Document trust boundaries, hook limitations, and install/update loop.
- [x] AC-6: Validate with local/headless Codex where feasible and record evidence.

## Notes

[2026-05-03]: Depends on `gw-ambient-parity-matrix` for exact hook claims.
[2026-05-03]: Implemented root Codex plugin bundle: `.codex-plugin/plugin.json`, `skills/groundwork/SKILL.md`, `hooks/hooks.json`, and `.agents/plugins/marketplace.json`. Hook config calls `groundwork codex hook`.
[2026-05-03]: Added CLI Codex surface: `codex doctor`, `codex install-project`, `codex install-user`, and `codex hook`. Project install writes `.codex/config.toml`, `.codex/hooks.json`, and `.codex/skills/groundwork/SKILL.md`; user install writes `$CODEX_HOME/hooks.json` and skill files.
[2026-05-03]: Initial hook behavior intentionally limited to `SessionStart` guidance and `PreToolUse` Bash risk denial. Full policy/session/provenance parity remains in behavior-specific follow-up items from `gw-ambient-parity-matrix`.
[2026-05-03]: Documented install surfaces, trust boundaries, and hook limitations in `docs/codex-integration.md`. Validation: `bun run test src/tests/cli.test.ts` and `bun run verify`. Tests simulate Codex hook stdin payloads for `SessionStart` and `PreToolUse` Bash denial; no external headless Codex run was performed in this slice.
[2026-05-03]: Reviewer found user install did not enable `codex_hooks`, project `force` could replace existing config wholesale, and tests missed install safety boundaries. Fixed by patching `[features].codex_hooks = true` for both project and user config files instead of replacing config, documenting `force` semantics, and adding tests for existing config preservation, skipped hook files, forced hook overwrite, and user hook enablement. Validation: `bun run test src/tests/cli.test.ts` and `bun run verify`.
[2026-05-03]: Re-review PASS. Reviewer confirmed user installs enable hooks, project `force` preserves config, existing feature tables are patched, install safety tests cover the boundary, and docs state patch/force behavior.
