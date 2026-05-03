# Remove Repo Skill And Legacy Config

## Status

Done

## Context

Groundwork is now the canonical CLI/runtime package. Agent-facing skills should live in `ai-plugins`, not inside this repo or installer output.

## Scope

- Remove the bundled `skills/groundwork` package surface from this repo.
- Stop Codex installers from writing `.codex/skills/groundwork/SKILL.md`.
- Remove legacy OpenCode policy config fallbacks and legacy policy env names.
- Rename destructive guard env names to `GROUNDWORK_*`.
- Update docs, manifests, and tests to the single Groundwork config surface.

## Acceptance

- No tracked in-repo Groundwork skill remains.
- `groundwork codex install-project` and `install-user` install hooks/config only.
- Policy config resolution only reads `groundwork.toml`, `.groundwork/*.toml`, `~/.groundwork/*.toml`, and Groundwork env overrides.
- Risk env config uses only `GROUNDWORK_DESTRUCTIVE_GUARD_*`.
- `bun run verify` passes.

## Review

- Reviewer requested explicit negative coverage for legacy OpenCode env names.
- Added regression tests proving old policy and destructive guard env names are ignored.

## Validation

- `bun run test -- src/tests/policy-config.test.ts src/tests/risk-rules.test.ts`
- `bun run verify`
