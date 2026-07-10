# References

Use these as the source of truth when extending or validating this skill.

## Groundwork Runtime Repo

Repository: `/Users/guilhermecastro/Projects/epistemology-framework`

- `README.md` — CLI-first install surface and integration overview
- `docs/codex-integration.md` — Codex hook installation, behavior, and limits
- `src/README.md` — runtime foundation layout and validation anchors
- `src/cli.ts` and `src/cli/` — CLI protocol, commands, Codex installers, and hook entrypoint
- `src/server.ts` — OpenCode plugin entrypoint

## Policy

- `src/policy/config.ts` — guardrail schema, canonical config discovery, includes, content matchers, actions, changed-line scope
- `src/policy/cli-service.ts` — CLI-facing policy evaluation and command state
- `src/policy/runtime.ts` — OpenCode runtime enforcement

## Context

- `src/context/cli-service.ts` — CLI-facing context discovery and touched-path reminders
- `src/context/` — inherited `AGENTS.md` / `CLAUDE.md` behavior

## Provenance

- `src/provenance/registry.ts` — authoritative `gw_*` tool list
- `src/provenance/tooling/` — local evidence and tool implementations
- `src/provenance/trace/` — trace storage and schemas
- `src/session/` — session artifact and compaction rendering

## Risk

- `src/risk/rules.ts` — destructive command evaluation rules and `GROUNDWORK_DESTRUCTIVE_GUARD_*` config
- `src/risk/service.ts` — CLI/runtime risk decision service

## AI Plugin Skill Home

Repository: `/Users/guilhermecastro/Projects/prism-plugins`

- `groundwork/plugin.json`
- `groundwork/skills/groundwork/SKILL.md`
- `groundwork/skills/groundwork/policy-authoring.md`
- `agent-foundations/skillspaces/global-skills.skillspace.ts`

## Companion Skills

- `skills/agents-md-author/SKILL.md`
- `skills/forge/SKILL.md`
- `skills/agentic-cli-authoring/SKILL.md`
- `skills/codex-configuration/SKILL.md`
- `skills/opencode-plugin-authoring/SKILL.md`
