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
- `bun run plugin:compile`
- `bun run verify`

## Groundwork Setup

The canonical policy entrypoint is `groundwork.toml`; additional project policy may live under `.groundwork/*.toml`. User-level policy may live under `~/.groundwork/*.toml`.

The Groundwork CLI should be available as `groundwork`. Prism-generated hooks spawn this binary (override with `GROUNDWORK_BIN`). If hook execution cannot rely on `PATH`, use `$HOME/.local/bin/groundwork` explicitly.

## Package Shape

- `@skastr0/groundwork`: root Bun CLI package exporting `groundwork` from `dist/cli.js`.
- `@skastr0/groundwork-core`: shared library under `packages/core` (policy, risk, context, provenance, session artifacts, portable hook decisions).
- In-repo Prism plugin: `prism-plugin/` — portable hooks (`hook` CLI) + `gw_*` tools + skills/rules. Compile/install with `prism refresh ./prism-plugin`.

Portable hook CLI surface:

- `groundwork hook session-start|prompt-submit|tool-before|tool-after|permission-request '<json>'`

## Boundaries

Keep harness integrations thin. Shared behavior belongs in the Groundwork foundations under `packages/core/src/`. The root CLI owns CLI protocol and local binary install scripts under `src/` and `scripts/`. Multi-harness distribution is owned by `prism-plugin/` + Prism compile — do not reintroduce per-harness native plugin packages.

## Validation Expectations

For narrow changes, run the closest targeted test or check. For integration, CLI, policy, risk, or package surface changes, run `bun run verify`.

Before changing `groundwork.toml`, `.groundwork/*.toml`, `packages/core/src/policy/**`, or harness integration files, load the `groundwork` skill.
