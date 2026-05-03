# Groundwork config paths

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-groundwork-config-paths

## Context

Groundwork is now CLI-first, but policy configuration still defaults to harness-coupled OpenCode paths:

- project: `.opencode/policy.toml`
- global: `~/.config/opencode/.opencode/policy.toml`
- env: `OPENCODE_POLICY_GUARDRAIL_CONFIG` and `OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG`

Groundwork should own its config namespace. The CLI and both integrations should load from Groundwork-owned paths by default while preserving legacy OpenCode paths as compatibility fallback.

## Acceptance Criteria

- [x] AC-1: Project policy config defaults to Groundwork-owned paths, supporting both `groundwork.toml` and `.groundwork/policy.toml`.
- [x] AC-2: Global policy config defaults to Groundwork-owned paths under `~/.groundwork/`, supporting multiple/complex TOML setups through includes.
- [x] AC-3: CLI, Codex hooks, and OpenCode plugin policy evaluation all use the same resolved config chain.
- [x] AC-4: Legacy `.opencode/policy.toml` and `OPENCODE_POLICY_GUARDRAIL_*` paths remain compatibility fallbacks with deterministic precedence.
- [x] AC-5: Tests cover default resolution, precedence, global+project merging, includes/globs, legacy fallback, and env overrides.
- [x] AC-6: Documentation explains setup for CLI, Codex, OpenCode, and policy TOML composition.
- [x] AC-7: Work is reviewed before moving to done.

## Notes

[2026-05-03]: Preferred project precedence: `groundwork.toml`, `.groundwork/policy.toml`, legacy `.opencode/policy.toml`.
[2026-05-03]: Preferred global precedence: `~/.groundwork/groundwork.toml`, `~/.groundwork/policy.toml`, legacy `~/.config/opencode/.opencode/policy.toml`.
[2026-05-03]: Preferred env precedence: `GROUNDWORK_POLICY_CONFIG`, then `OPENCODE_POLICY_GUARDRAIL_CONFIG`; `GROUNDWORK_POLICY_GLOBAL_CONFIG`, then `OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG`.
[2026-05-03]: Implemented path-chain resolution: project `groundwork.toml` plus existing `.groundwork/*.toml`, global `~/.groundwork/*.toml`, then legacy OpenCode fallbacks only when no Groundwork config exists.
[2026-05-03]: Validation passed: `bun run test src/tests/policy-config.test.ts src/tests/cli.test.ts src/tests/index.test.ts src/tests/policy-runtime.test.ts`; `bun run verify` passed 25 suites / 214 tests plus build/import/CLI smoke.
[2026-05-03]: Review found no correctness bugs. Added requested coverage for `.groundwork` overriding root `groundwork.toml`, `GROUNDWORK_POLICY_GLOBAL_CONFIG` precedence, and Codex hook policy denial through canonical `groundwork.toml`.
[2026-05-03]: Final validation passed: `bun run test src/tests/policy-config.test.ts src/tests/cli.test.ts src/tests/index.test.ts src/tests/policy-runtime.test.ts` passed 4 suites / 108 tests; `bun run verify` passed 25 suites / 217 tests plus build/import/CLI smoke.
