# Groundwork

`plugin/groundwork.ts` is the single discovery barrel for this system. Active runtime code, tooling, tests, and documentation all live under `plugin/groundwork/`.

## Home Layout

- `layer/` — hook composition and dispatch order
- `kernel/` — shared session state, caches, budgets, and prompt context helpers
- `logger/` — shared framework logger
- `policy/` — policy config parsing, matching, enforcement, and violation artifacts
- `context/` — `AGENTS.md` and `CLAUDE.md` discovery plus prompt injection
- `provenance/` — runtime hooks, `gw_*` tool registry, local evidence, trace storage, and provenance tooling
- `risk/` — destructive command evaluation and bash gating
- `tests/` — framework-owned coverage for policy, context, provenance, risk, trace, and composition

## Layer Order

The framework dispatch order is intentional:

1. `policy`
2. `context`
3. `provenance`
4. `risk`

That order matters:

- `policy` blocks or injects before other layers add context.
- `context` injects inherited instructions before provenance augments tool guidance.
- `provenance` captures evidence and enriches tool definitions after policy and context are settled.
- `risk` is the final stop for destructive bash commands.

## Policy

The framework reads Groundwork-owned policy config by default.

Supported behavior includes:

- project paths: `groundwork.toml` and `.groundwork/*.toml`
- global paths: `~/.groundwork/*.toml`
- env overrides: `GROUNDWORK_POLICY_CONFIG` / `GROUNDWORK_POLICY_GLOBAL_CONFIG`
- reusable policy plugins via `plugin` or `plugins`
- include graphs via `include` or `includes`
- rule-level tool filters, content matchers, and scope controls
- session commands: `/policy override <reason>` and `/policy skill-loaded <skill...>`

Policy violations are recorded as IAP artifacts under `.agents/messages/` using the file pattern:

- `<timestamp>-groundwork-policy-<rule>.json`

## Provenance

The framework owns the full `gw_*` tool surface under `provenance/`:

- tool builders: `provenance/tooling/`
- local evidence ranking: `provenance/local-evidence.ts`
- trace storage and schemas: `provenance/trace/`
- runtime hooks and tool-definition augmentation: `provenance/runtime.ts`

## Validation Anchors

- `plugin/groundwork/tests/index.test.ts`
- `plugin/groundwork/tests/policy-config.test.ts`
- `plugin/groundwork/tests/policy-runtime.test.ts`
- `plugin/groundwork/tests/context-runtime.test.ts`
- `plugin/groundwork/tests/provenance-runtime.test.ts`
- `plugin/groundwork/tests/provenance-query-tools.test.ts`
- `plugin/groundwork/tests/provenance-tree-tools.test.ts`
- `plugin/groundwork/tests/provenance-evidence.test.ts`
- `plugin/groundwork/tests/risk.test.ts`
- `plugin/groundwork/tests/risk-rules.test.ts`
