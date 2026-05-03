# Groundwork OpenCode thin wrapper

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-opencode-thin-wrapper

## Context

The current OpenCode plugin still owns significant business logic. The target architecture is CLI-first: OpenCode hooks and `gw_*` tools should become thin adapters over shared CLI/core behavior while preserving existing OpenCode runtime affordances where they are stronger than Codex.

## Acceptance Criteria

- [x] AC-1: Identify current OpenCode plugin logic that should move behind CLI/core commands.
- [x] AC-2: Refactor at least one foundation path so OpenCode calls the same CLI/core service as the CLI.
- [x] AC-3: Preserve OpenCode tool IDs and hook behavior for the refactored path.
- [x] AC-4: Add tests proving the wrapper and CLI produce compatible decisions/results.
- [x] AC-5: Document remaining non-thin wrapper paths as follow-up items.

## Notes

[2026-05-03]: Prefer incremental refactors after the CLI foundation stabilizes.
[2026-05-03]: Refactored the risk Bash guardrail as the first thin-wrapper path. Added `src/risk/service.ts` with `evaluateRiskCommand` and `riskViolationMessage`; `groundwork risk evaluate-command`, `groundwork codex hook`, and OpenCode `tool.execute.before` risk enforcement now call the same service.
[2026-05-03]: Preserved OpenCode behavior for the refactored path: hook remains `tool.execute.before`, only applies to `bash`, warns/logs in warn mode, and throws `FrameworkEnforcementError` in block mode with the same `[groundwork:risk] ... (rule: ...)` message.
[2026-05-03]: Added compatibility coverage in `src/tests/risk.test.ts`: the same `git reset --hard` input is evaluated through the CLI and OpenCode hook, and the test asserts matching rule id/reason plus preserved OpenCode logging. Validation: `bun run test src/tests/risk.test.ts src/tests/cli.test.ts`.
[2026-05-03]: Reviewer found the first service contract still returned `block` for warn/off modes and Codex hardcoded default block-mode config. Fixed `evaluateRiskCommand` to return `allow | warn | block`, made off return allow/no violation, made Codex hook use `configFromEnv(process.env)`, and added CLI/Codex/OpenCode coverage for warn/off plus non-Bash hook no-op. Validation: `bun run test src/tests/risk.test.ts src/tests/cli.test.ts` and `bun run verify`.
[2026-05-03]: Re-review confirmed the code findings were resolved but observed one unrelated full-suite timeout in `src/tests/policy-config.test.ts`. Re-ran `bun run verify` locally after the review; it passed with 25 test files and 182 tests, then build/import/check:cli succeeded.
[2026-05-03]: Final re-review PASS. Reviewer confirmed no blocking issue remains, scoped risk/CLI tests pass, and the shared service/runtime/Codex wiring resolves the prior mode compatibility findings.

## Remaining Non-Thin Paths

- Policy runtime still owns OpenCode-specific session kernel behavior, prompt injection, override locks, content checks, and post-mutation checks. Follow-up: `gw-policy-cli`.
- Provenance tools beyond repo/file state still need CLI parity. Follow-up: `gw-provenance-cli-parity`.
- Context reminder injection and dedupe still rely on OpenCode `client.session.prompt`. Follow-up: `gw-context-hook-state`.
- Cross-hook/session state needs durable artifacts before Codex and OpenCode can share all ambient behavior. Follow-up: `gw-session-artifacts`.
- OpenCode compaction support remains OpenCode-specific. Follow-up: `gw-compaction-render`.
