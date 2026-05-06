# Groundwork CLI root option preflight

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-cli-root-options-preflight

## Context

The CLI command-shape preflight preserves deterministic JSON failure envelopes for agent-facing domain commands. It currently inspects raw argv before `@effect/cli` handles root options, so advertised root options such as `--completions` and `--log-level` are rejected as unknown commands.

## Acceptance Criteria

- [x] AC-1: `groundwork --completions <shell>` is passed through to the Effect CLI completion handler instead of JSON preflight rejection.
- [x] AC-2: Root `--log-level <level>` / `--log-level=<level>` can be used before commands without breaking command execution.
- [x] AC-3: Domain parser failures still return deterministic JSON-only failure envelopes.
- [x] AC-4: CLI tests cover the regression and pass.

## Notes

[2026-05-06]: Started while exercising the CLI feature surface. Manual repro: `bun ./src/cli.ts --completions zsh` and `bun ./src/cli.ts --log-level none doctor` both fail as unknown commands.
[2026-05-06]: Fixed preflight by passing completion generation through and stripping supported root execution options before domain command-shape validation. Added CLI regression tests for completions, `--log-level`, and JSON-only missing-input failures. Validation: `bun run typecheck`, `bun run test src/tests/cli.test.ts --reporter=dot`, `groundwork --log-level none doctor`, and `groundwork --completions zsh`.
