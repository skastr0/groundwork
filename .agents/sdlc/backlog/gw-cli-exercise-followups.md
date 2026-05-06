# Groundwork CLI exercise follow-ups

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-cli-exercise-followups

## Context

The CLI surface exercise found no broad command-family functional failures, but it surfaced design and performance gaps that should be handled as focused follow-up slices instead of being mixed into discovery fixes.

## Acceptance Criteria

- [x] AC-1: Decide whether direct provenance commands should keep direct data envelopes while registry-backed commands return nested tool envelopes, or whether a normalized compatibility shape is needed.
- [x] AC-2: Reduce `provenance pr-materialize` no-PR fallback latency or add an explicit cheap local/no-remote mode path.
- [ ] AC-3: Clarify `policy override` semantics: one-shot lock clearing vs durable approval with scope/TTL.
- [x] AC-4: Prevent or clearly mark pending tool snapshots for pre-tool calls that policy already blocked.
- [ ] AC-5: Evaluate compact output modes for noisy session/context commands, especially `session get` mutation responses and `context discover` full-content output.
- [x] AC-6: Improve terminal `--help` discoverability or make help text point directly to `capabilities`, `schema show`, and `examples show`.

## Notes

[2026-05-06]: Created from side-agent CLI exercise findings. Provenance commands were exercised against `/Users/guilhermecastro/Projects/Voyager/playground/todo-playground` and `/Users/guilhermecastro/Projects/opencode-plugin-prompt-skill-pill`; policy/context/session and Codex paths were exercised against temp fixtures plus `/Users/guilhermecastro/Projects/agentpkg`.
[2026-05-06]: AC-4 completed in `.agents/sdlc/done/gw-policy-blocked-pending-tools.md`.
[2026-05-06]: AC-6 completed in `.agents/sdlc/done/gw-cli-help-discoverability.md`.
[2026-05-06]: AC-2 completed in `.agents/sdlc/done/gw-pr-materialize-local-mode-contract.md`: `mode: "local"` is the explicit no-remote path, public examples advertise it, and regression coverage now proves it does not invoke `gh`.
[2026-05-06]: AC-1 completed in `.agents/sdlc/done/gw-provenance-output-shape-contract.md`: direct provenance state commands keep direct DTO output for compatibility, while registry-backed commands advertise `provenance_result` in capabilities.
