# Groundwork Repository Guidance

## Project

This repository contains Groundwork, a JSON-first CLI and package set for policy, provenance, context, risk, and session artifact foundations, plus an in-repo Prism plugin that lowers hooks and tools to supported coding harnesses.

## Package Manager

Use Bun for dependency, build, and verification commands.

Common commands:

- `bun install`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run check:imports`
- `bun run check:cli`
- `bun run plugin:package` (requires `prism-dev`)
- `bun run verify`

## Groundwork Setup

The canonical policy entrypoint is `groundwork.toml`; additional project policy may live under `.groundwork/*.toml`. User-level policy may live under `~/.groundwork/*.toml`.

The Groundwork CLI should be available as `groundwork`. Compiled harness plugins spawn this binary (override with `GROUNDWORK_BIN`). If hook execution cannot rely on `PATH`, use `$HOME/.local/bin/groundwork` explicitly.

## Package Shape

- `@skastr0/groundwork`: root Bun CLI package exporting `groundwork` from `dist/cli.js`.
- `@skastr0/groundwork-core`: shared library under `packages/core` (policy, risk, context, provenance, session artifacts, portable hook decisions).
- `prism-plugin/`: **portable source** (hooks/tools/skills). Author here only.
- `packages/<harness>/`: **shipped native plugins** produced by `bun run plugin:package` (`prism-dev package` + materialize). Users install these with harness-native mechanisms (Codex marketplace, Claude plugin, OpenCode plugin entry, Grok plugin). Users do **not** run Prism to use Groundwork.

Portable hook CLI surface (used by compiled wrappers):

- `groundwork hook session-start|prompt-submit|tool-before|tool-after|permission-request '<json>'`

See `docs/harness-plugins.md` and `docs/codex-integration.md`.

## Boundaries

Keep harness integrations thin. Shared behavior belongs in `packages/core/src/`. The root CLI owns CLI protocol under `src/`. Portable plugin source is `prism-plugin/`. Do not hand-edit files under `packages/` — regenerate with `plugin:package`.

## Validation Expectations

For narrow changes, run the closest targeted test or check. For integration, CLI, policy, risk, or package surface changes, run `bun run verify`.

Before changing `groundwork.toml`, `.groundwork/*.toml`, `packages/core/src/policy/**`, or harness integration files, load the `groundwork` skill.
