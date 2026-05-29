# Groundwork Repository Guidance

## Project

This repository contains Groundwork, a JSON-first CLI and thin Codex/OpenCode integration layer for policy, provenance, context, risk, and session artifact foundations.

## Package Manager

Use Bun for dependency, build, and verification commands.

Common commands:

- `bun install`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run check:imports`
- `bun run check:cli`
- `bun run verify`

## Groundwork Setup

The canonical policy entrypoint is `groundwork.toml`; additional project policy may live under `.groundwork/*.toml`. User-level policy may live under `~/.groundwork/*.toml`.

The Groundwork CLI should be available as `groundwork`. If hook execution cannot rely on `PATH`, use `$HOME/.local/bin/groundwork` explicitly.

Codex integration files:

- `.codex-plugin/plugin.json`
- `hooks/hooks.json`
- generated `.codex/config.toml`
- generated `.codex/hooks.json`

OpenCode integration entrypoints:

- `src/server.ts`
- `dist/server.js` after `bun run build`
- local OpenCode config can point at this checkout during development

## Boundaries

Keep harness integrations thin. Shared behavior belongs in the Groundwork foundations under `src/policy/`, `src/context/`, `src/provenance/`, `src/risk/`, `src/session/`, and `src/cli/`.

Do not put the Groundwork skill inside this runtime repo. The skill source lives outside this package and is installed into harness skill directories from there.

## Validation Expectations

For narrow changes, run the closest targeted test or check. For integration, CLI, policy, risk, or package surface changes, run `bun run verify`.

Before changing `groundwork.toml`, `.groundwork/*.toml`, `src/policy/**`, or harness integration files, load the `groundwork` skill.
