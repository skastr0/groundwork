# Epistemology Framework

`plugin/epistemology-framework.ts` is the single discovery barrel for this system. Active runtime code, tooling, tests, and documentation all live under `plugin/epistemology-framework/`.

## Home Layout

- `layer/` — hook composition and dispatch order
- `kernel/` — shared session state, caches, budgets, and prompt context helpers
- `logger/` — shared framework logger
- `policy/` — policy config parsing, matching, enforcement, and violation artifacts
- `worldview/` — `AGENTS.md` and `CLAUDE.md` discovery plus prompt injection
- `provenance/` — runtime hooks, `prov_*` tool registry, local evidence, trace storage, and provenance tooling
- `mutation-risk/` — destructive command evaluation and bash gating
- `tests/` — framework-owned coverage for policy, worldview, provenance, mutation-risk, trace, and composition

## Layer Order

The framework dispatch order is intentional:

1. `policy`
2. `worldview`
3. `provenance`
4. `mutation-risk`

That order matters:

- `policy` blocks or injects before other layers add context.
- `worldview` injects inherited instructions before provenance augments tool guidance.
- `provenance` captures evidence and enriches tool definitions after policy and worldview context is settled.
- `mutation-risk` is the final stop for destructive bash commands.

## Policy

The framework reads `.opencode/policy.toml`.

Supported behavior includes:

- project path: `.opencode/policy.toml`
- global path: `~/.config/opencode/.opencode/policy.toml`
- env overrides: `OPENCODE_POLICY_GUARDRAIL_CONFIG` and `OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG`
- include graphs via `include` or `includes`
- rule-level tool filters, content matchers, and scope controls
- session commands: `/policy override <reason>` and `/policy skill-loaded <skill...>`

Policy violations are recorded as IAP artifacts under `.agents/messages/` using the file pattern:

- `<timestamp>-epistemology-framework-policy-<rule>.json`

## Provenance

The framework owns the full `prov_*` tool surface under `provenance/`:

- tool builders: `provenance/tooling/`
- local evidence ranking: `provenance/local-evidence.ts`
- trace storage and schemas: `provenance/trace/`
- runtime hooks and tool-definition augmentation: `provenance/runtime.ts`

## Validation Anchors

- `plugin/epistemology-framework/tests/index.test.ts`
- `plugin/epistemology-framework/tests/policy-config.test.ts`
- `plugin/epistemology-framework/tests/policy-runtime.test.ts`
- `plugin/epistemology-framework/tests/worldview-runtime.test.ts`
- `plugin/epistemology-framework/tests/provenance-runtime.test.ts`
- `plugin/epistemology-framework/tests/provenance-query-tools.test.ts`
- `plugin/epistemology-framework/tests/provenance-tree-tools.test.ts`
- `plugin/epistemology-framework/tests/provenance-evidence.test.ts`
- `plugin/epistemology-framework/tests/mutation-risk.test.ts`
- `plugin/epistemology-framework/tests/mutation-risk-rules.test.ts`
