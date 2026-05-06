# Groundwork CLI surface exercise

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-cli-surface-exercise

## Context

The active goal requires exercising every Groundwork CLI feature across local projects, gauging functionality and performance, finding/fixing bugs, and identifying tasteful strategic surface gaps. Recent work hardened build/install and improved context/provenance internals; the next step is an explicit command-family coverage pass against real local repositories and temporary fixtures.

## Acceptance Criteria

- [x] AC-1: Inventory the installed CLI command and schema surface from `groundwork capabilities` and `groundwork schema list`.
- [x] AC-2: Exercise every command family at least once: discovery/schema/examples, Codex integration/hooks, risk, context, policy, provenance, and session.
- [x] AC-3: Run representative provenance commands against at least two real local projects under `~/Projects` or `~/Projects/Voyager/playground`.
- [x] AC-4: Capture observed failures, slow paths, confusing contracts, or high-impact feature gaps as fixes or follow-up SDLC backlog items.
- [x] AC-5: Validate any fixes with targeted tests and `bun run verify`, then commit the completed slice.

## Notes

[2026-05-06]: Started after build/install-local adoption and query provenance refactor. Side agents are covering provenance, policy/context/session, and discovery/Codex integration while the main thread verifies inventory and handles fixes.
[2026-05-06]: Inventory found 39 advertised capabilities and 34 schema contracts in the installed CLI before this slice. Source fix expands capabilities to include `schema list/show` and `examples list/show`, then aligns examples with every advertised command.
[2026-05-06]: Provenance sidecar exercised all provenance commands against `/Users/guilhermecastro/Projects/Voyager/playground/todo-playground` and `/Users/guilhermecastro/Projects/opencode-plugin-prompt-skill-pill`; all returned OK. Policy/context/session sidecar exercised all requested commands against temp fixtures and `agentpkg`; all returned OK. Discovery/Codex sidecar exercised temp install/hook paths and found the `codex doctor` status bug fixed in this slice.
[2026-05-06]: Follow-up design/performance issues captured in `.agents/sdlc/backlog/gw-cli-exercise-followups.md`.
[2026-05-06]: Verification passed: `bun run typecheck`; focused `bun run test src/tests/cli.test.ts -t "Codex integration readiness|examples|capabilities" --reporter=verbose`; full `bun run verify` passed 25 files / 231 tests plus build/import/dist CLI/local-install checks.
[2026-05-06]: Reviewer follow-up tightened `codex doctor` readiness to verify project `config.toml` and `hooks.json`, discover parent `.codex` roots from nested directories, canonicalize home/CODEX_HOME stop boundaries before comparing, avoid treating user-level `~/.codex`/`CODEX_HOME` as project readiness, keep empty `.codex` as `missing`, report project-only `.codex` files without plugin bundle as `partial`, and round-trip every advertised command id through public `examples list/show`. Re-ran full `bun run verify`: 25 files / 233 tests plus build/import/dist CLI/local-install checks passed.
