# Groundwork CLI help discoverability

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-cli-help-discoverability

## Context

The CLI surface exercise found that terminal help is technically available but weak for agents: leaf commands often render without descriptions, and the root help does not directly point to the JSON discovery commands that expose capabilities, schemas, and examples.

## Acceptance Criteria

- [x] AC-1: Root `--help` points users toward `capabilities`, `schema show`, and `examples show`.
- [x] AC-2: Leaf commands in major command groups render useful help descriptions instead of blank command rows.
- [x] AC-3: Tests assert the help output exposes the discovery path and representative leaf command descriptions.
- [x] AC-4: Run targeted validation and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-cli-exercise-followups.md` AC-6.
[2026-05-06]: Reused `COMMAND_CAPABILITIES` descriptions for Effect CLI help so terminal help and JSON discovery stay aligned. Root help now points directly at `groundwork capabilities`, `groundwork schema show <command>`, and `groundwork examples show <command>`.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/cli.test.ts -t "discoverable help" --reporter=verbose`.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 234 tests plus build/import/dist CLI/local-install checks.
