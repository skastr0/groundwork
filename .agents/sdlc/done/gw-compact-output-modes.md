# Groundwork compact output modes

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-compact-output-modes

## Context

The CLI exercise follow-ups flagged noisy output from `context discover` and `session get`. Both commands should keep compatibility by default, but expose compact modes for agents that only need metadata or session summary state.

## Acceptance Criteria

- [x] AC-1: `context discover` supports an input option that omits full file content while preserving path/file metadata.
- [x] AC-2: `session get` supports a compact summary view that avoids returning the full durable state object.
- [x] AC-3: Schemas, examples, and tests cover the compact output modes.
- [x] AC-4: Run targeted validation and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-cli-exercise-followups.md` AC-5.
[2026-05-06]: Added `context discover` `include_content: false`, returning path/fileName/content_bytes without full content, and `session get` `view: "summary"`, returning compact counts without `state`.
[2026-05-06]: Updated schema contracts and examples for both compact modes. Targeted validation passed: `bun run typecheck`; `bun run test src/tests/cli.test.ts -t "discovers inherited context files|persists and cleans up durable session artifacts|schemas|examples" --reporter=verbose`; manual `schema show context.discover` and `schema show session.get` smoke.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 236 tests plus build/import/dist CLI/local-install checks.
[2026-05-06]: Contract review follow-up: `examples list` now includes `example_count` and compact example variants, so compact `context.discover` and `session.get` examples are discoverable from both list and show output.
