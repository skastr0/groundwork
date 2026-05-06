# Groundwork CLI build/install adoption

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-cli-build-install-adoption

## Context

The Groundwork CLI should follow the local binary build/install conventions used by `../opencode-plugin-agent-ide` and sibling CLI projects while preserving Groundwork's mixed package surface (`dist/server.js`, `dist/cli.js`, and standalone `dist/groundwork-<platform>-<arch>` binaries).

Recent Codex hook failures show `hook exited with code 127` for hook commands that rely on bare `groundwork` lookup. Project-local hooks already use an explicit installed binary, but bundled plugin hooks still depend on `PATH`.

## Acceptance Criteria

- [x] AC-1: `bun run build` and `bun run build:cli` keep the standalone CLI binary workflow aligned with sibling projects.
- [x] AC-2: `bun run install:local` continues to install the current-platform standalone binary into the local bin directory and keeps hook execution independent of Bun global-link state.
- [x] AC-3: Bundled Codex plugin hooks no longer fail solely because bare `groundwork` is absent from hook `PATH` when `$HOME/.local/bin/groundwork` exists.
- [x] AC-4: Targeted tests and build/install verification pass.

## Notes

[2026-05-06]: Created after comparing Groundwork scripts with `../opencode-plugin-agent-ide`, `../type-level-tools`, and `../agentpkg`.
[2026-05-06]: Updated `bun run build` to run `build:cli` before `build:js`; `build:cli` now cleans stale standalone Groundwork binaries before compiling the target matrix while preserving package JS outputs for the following build step.
[2026-05-06]: Updated `install:local` messaging to match sibling local binary installers and reinstalled `/Users/guilhermecastro/.local/bin/groundwork`.
[2026-05-06]: Updated bundled Codex plugin hooks to use `groundwork` when present and fall back to `$HOME/.local/bin/groundwork`, fixing the observed `hook exited with code 127` path for minimal hook environments.
[2026-05-06]: Validation passed: `bun run test src/tests/cli.test.ts --reporter=verbose` (65 tests), `bun run build`, `bun run install:local`, `bun run check:imports`, `bun run check:cli`, `bun run check:local-install`, minimal-PATH bundled hook fallback smoke test, and full `bun run verify` (25 files / 237 tests plus build/import/CLI/local-install).
