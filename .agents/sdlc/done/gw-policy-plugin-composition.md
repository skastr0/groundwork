# Policy Plugin Composition

## Status

Done

## Context

Groundwork policy should support reusable, composable policy packs in addition to direct includes. The immediate target is a reusable `groundwork-effect` policy and canonical TypeScript guardrails.

## Scope

- Add basic `plugins = [...]` support to policy TOML.
- Resolve absolute paths, relative paths, and bare plugin names.
- Add canonical user policy files under `~/.groundwork/`.
- Add this repo's `groundwork.toml`.
- Validate with focused tests and `bun run verify`.

## Acceptance

- `plugins = ["groundwork-effect"]` can resolve a user plugin policy file.
- Absolute and relative plugin paths are supported.
- Project rules can compose with user/global policy.
- `~/.groundwork/groundwork.toml`, `~/.groundwork/semgrep/typescript-guardrails.yml`, and `~/.groundwork/groundwork-effect.toml` exist.
- This repo has a project `groundwork.toml`.

## Review

- Fixed `~/...` plugin path resolution to honor the configured `HOME`.
- Fixed bare plugin resolution so root-level sibling files do not shadow project `.groundwork` packs.
- Made composition-only configs with `plugins` or `includes` legal.

## Validation

- `bun run test -- src/tests/policy-config.test.ts`
- `bun run verify`
