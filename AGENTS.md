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

The Groundwork CLI should be available as `groundwork`. If hook execution cannot rely on `PATH`, use `/Users/guilhermecastro/.bun/bin/groundwork` explicitly.

Codex integration files:

- `.codex-plugin/plugin.json`
- `hooks/hooks.json`
- `.codex/config.toml`
- `.codex/hooks.json`

OpenCode integration entrypoints:

- `src/server.ts`
- `dist/server.js` after `bun run build`
- global OpenCode config points at `file:///Users/guilhermecastro/Projects/groundwork`

## Boundaries

Keep harness integrations thin. Shared behavior belongs in the Groundwork foundations under `src/policy/`, `src/context/`, `src/provenance/`, `src/risk/`, `src/session/`, and `src/cli/`.

Do not put the Groundwork readiness skill inside this runtime repo. The skill source lives in `/Users/guilhermecastro/Projects/prism-plugins/groundwork-readiness/skills/groundwork-readiness` and is installed into harness skill directories from there.

## Validation Expectations

For narrow changes, run the closest targeted test or check. For integration, CLI, policy, risk, or package surface changes, run `bun run verify`.

Before changing `groundwork.toml`, `.groundwork/*.toml`, `src/policy/**`, or harness integration files, load the `groundwork-readiness` skill.
