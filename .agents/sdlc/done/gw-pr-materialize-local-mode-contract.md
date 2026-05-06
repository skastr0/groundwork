# Groundwork PR materialize local mode contract

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-pr-materialize-local-mode-contract

## Context

The CLI exercise follow-ups flagged `provenance pr-materialize` no-PR fallback latency. The command already exposes `mode: "local"` as the explicit cheap/no-remote path, and the published examples use it, but the behavior needs a regression test so future changes do not accidentally invoke `gh` in local mode.

## Acceptance Criteria

- [x] AC-1: Prove `gw_pr_materialize` local mode does not require or invoke remote PR lookup.
- [x] AC-2: Prove local mode still returns deterministic local branch fallback context.
- [x] AC-3: Update the CLI follow-up backlog to record the local/no-remote contract.
- [x] AC-4: Run targeted validation and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Created from `.agents/sdlc/backlog/gw-cli-exercise-followups.md` AC-2.
[2026-05-06]: Added a `gw_pr_materialize` unit test that records shell commands, installs a failing `gh` stub, invokes `{ "mode": "local" }`, and asserts no `gh` command was executed while local branch fallback context is returned.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-pr-tools.test.ts -t "local PR materialization" --reporter=verbose`. Discovery smoke confirmed `examples show provenance.pr-materialize` advertises `{"mode":"local","limit":10}`.
[2026-05-06]: Full validation passed: `bun run verify` completed 25 files / 235 tests plus build/import/dist CLI/local-install checks.
