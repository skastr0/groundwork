# Groundwork CLI foundation

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-cli-foundation

## Context

Groundwork should move toward a CLI-first architecture. The CLI owns reusable business logic and exposes a JSON-first surface that Codex skills/hooks and OpenCode plugin wrappers can call without duplicating domain behavior.

This first slice creates the standalone CLI protocol and wires a small but useful set of commands to existing modules. Later slices will move more OpenCode hook behavior behind the CLI and add Codex plugin/config installers.

## Acceptance Criteria

- [x] AC-1: Package exposes a standalone `groundwork` binary install surface.
- [x] AC-2: CLI uses JSON input via inline JSON, `@file`, and stdin for domain commands.
- [x] AC-3: CLI success and failure output use deterministic JSON envelopes on stdout/stderr.
- [x] AC-4: CLI exposes discovery commands: `doctor`, `capabilities`, `schema list/show`, and `examples list/show`.
- [x] AC-5: CLI exposes initial working foundation commands for risk, context, and provenance using existing Groundwork logic.
- [x] AC-6: Typecheck and targeted CLI command tests pass.
- [x] AC-7: Reviewer signs off before the work item moves to done.

## Notes

[2026-05-03]: Started after rename to Groundwork. Initial command set: `risk evaluate-command`, `context discover`, `provenance repo-state`, and `provenance file-state`.
[2026-05-03]: Implemented `src/cli.ts` plus `src/cli/*` protocol/discovery/commands. Added package `bin.groundwork`, `exports["./cli"]`, and CLI build/check scripts. Validation: `bun run typecheck`, `bun run test -- src/tests/cli.test.ts`, `bun run build`, `bun ./dist/cli.js doctor`, and manual schema/example/provenance commands.
[2026-05-03]: Reviewer found parser errors could emit non-JSON output, runtime schemas accepted extra fields despite `additionalProperties: false`, and CLI tests were too narrow. Fixed with command-shape preflight JSON failures, strict Zod schemas, and broader CLI coverage for parser failures, discovery, context, and provenance. Validation: `bun run test src/tests/cli.test.ts` and `bun run verify`.
[2026-05-03]: Follow-up review PASS. Reviewer found no blocking correctness issues and confirmed parser-shape preflight, strict schemas, JSON failure envelopes, CLI tests, and install surface.
