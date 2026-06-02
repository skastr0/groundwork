# Groundwork Repository Guidance

## Project

This repository contains Groundwork, a JSON-first CLI and package set for policy, provenance, context, risk, and session artifact foundations.

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

## Package Shape

- `@skastr0/groundwork`: root Bun CLI package exporting `groundwork` from `dist/cli.js`.
- `@skastr0/groundwork-core`: shared library under `packages/core`.
- `@skastr0/groundwork-opencode-plugin`: OpenCode runtime wrapper under `packages/opencode-plugin`, using the core library.
- `@skastr0/groundwork-codex`: self-contained Codex plugin bundle under `packages/codex`, with `.codex-plugin/plugin.json`, `hooks/hooks.json`, shell/cmd wrappers, and `dist/groundwork-codex-hook.mjs`.

Codex integration files:

- `packages/codex/.codex-plugin/plugin.json`
- `packages/codex/hooks/hooks.json`
- `packages/codex/hooks/groundwork-codex-hook.sh`
- `packages/codex/hooks/groundwork-codex-hook.cmd`
- `packages/codex/dist/groundwork-codex-hook.mjs` after `bun run build`

OpenCode integration entrypoints:

- `packages/opencode-plugin/src/server.ts`
- `packages/opencode-plugin/dist/server.js` after `bun run build`
- local OpenCode config can point at this checkout during development

## Boundaries

Keep harness integrations thin. Shared behavior belongs in the Groundwork foundations under `packages/core/src/`. The root CLI owns CLI protocol and local binary install scripts under `src/` and `scripts/`; package-specific runtime wrappers live under `packages/opencode-plugin/` and `packages/codex/`.

Do not put the Groundwork skill inside this runtime repo. The skill source lives outside this package and is installed into harness skill directories from there.

## Validation Expectations

For narrow changes, run the closest targeted test or check. For integration, CLI, policy, risk, or package surface changes, run `bun run verify`.

Before changing `groundwork.toml`, `.groundwork/*.toml`, `packages/core/src/policy/**`, or harness integration files, load the `groundwork` skill.
