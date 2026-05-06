# Groundwork context root guidance semantics

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-context-root-guidance-semantics

## Context

CLI exercising against `/Users/guilhermecastro/Projects/agentpkg` and `/Users/guilhermecastro/Projects/ai-plugins` showed that `groundwork context discover` returns no files for root-level targets even when the project root has `AGENTS.md`.

This is currently intentional in `src/tests/context-discovery.test.ts`: root-level context files are excluded so only nested inherited guidance is returned. That may be right for harness contexts that already inject root guidance, but it is surprising for CLI-only workflows and cross-project audits.

## Acceptance Criteria

- [ ] AC-1: Decide whether root-level `AGENTS.md` / `CLAUDE.md` should be included by default, excluded by default, or exposed through an explicit input option.
- [ ] AC-2: Document the chosen semantics in CLI docs and schema/capability descriptions.
- [ ] AC-3: Add tests for root-level targets, nested targets, and CLI-only representative behavior.
- [ ] AC-4: If behavior changes, verify `context discover`, `context touched-paths`, Codex hook feedback, and OpenCode context runtime remain coherent.

## Notes

[2026-05-06]: Repro: `groundwork context discover '{"root_dir":"/Users/guilhermecastro/Projects/agentpkg","directory":"/Users/guilhermecastro/Projects/agentpkg","target_path":"package.json"}'` returns `files: []` despite `/Users/guilhermecastro/Projects/agentpkg/AGENTS.md`.
