# Groundwork Codex hook resilient command

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-codex-hook-resilient-command

## Context

Codex hook failures reported `hook exited with code 127` and broken pipe writes. The active project hooks point at `/Users/guilhermecastro/.bun/bin/groundwork codex hook`, but that shim currently resolves through Bun global install state to a missing `dist/cli.js`.

The generated hook command should not depend on `PATH` or a mutable global package shim. It can call the active Bun executable and the active CLI entrypoint directly.

## Acceptance Criteria

- [x] AC-1: Generated Codex hook config defaults to an absolute Bun executable plus the current CLI entrypoint.
- [x] AC-2: Explicit `hook_command` overrides are still preserved verbatim.
- [x] AC-3: Repo-installed hook files no longer point at the broken global `groundwork` shim.
- [x] AC-4: Tests cover the generated default command and hook execution still passes.

## Notes

[2026-05-06]: Repro confirmed: `/Users/guilhermecastro/.bun/bin/groundwork` is a symlink to `../install/global/node_modules/groundwork/dist/cli.js`, while `node_modules/groundwork` points at `/Users/guilhermecastro/Projects/epistemology-framework`; the target `dist/cli.js` is missing. Direct `bun ./dist/cli.js codex hook` works.
[2026-05-06]: Added `build:cli` and `install:local` scripts adapted from the local binary-install pattern in `../opencode-plugin-agent-ide`. `bun run build` now emits package JS and standalone platform binaries, and `bun run install:local` installs `/Users/guilhermecastro/.local/bin/groundwork`.
[2026-05-06]: Updated generated Codex hook defaults. Source/dev invocations generate `'<bun>' '<src/cli.ts>' codex hook`; standalone installed binaries generate `'<binary>' codex hook`; explicit `hook_command` is unchanged.
[2026-05-06]: Reinstalled project Codex hooks with the working local binary. Validation: `bun run build`, `bun run install:local`, `groundwork doctor`, `env -i PATH=/usr/bin:/bin /Users/guilhermecastro/.local/bin/groundwork doctor`, quoted hook command via `zsh -c`, `groundwork codex doctor`, `bun run check:imports`, `bun run check:cli`, and `bun run test src/tests/cli.test.ts --reporter=dot`.
[2026-05-06]: Review follow-up: added `scripts/check-local-install.ts` and wired `bun run check:local-install` into `bun run verify` so the standalone binary branch and temp local install are covered by a repeatable gate.
