# Example Layouts

## Consumer Code Repository

```text
repo/
├── AGENTS.md
├── groundwork.toml
├── .groundwork/
│   ├── policy.generated.toml
│   └── policy.secrets.toml
├── .codex/
│   ├── config.toml
│   └── hooks.json
├── src/
├── tests/
└── package.json
```

Use this when the workspace mainly ships code but still wants policy, context, provenance, and risk to matter.

## Groundwork Source Repository

```text
repo/
├── AGENTS.md
├── groundwork.toml
├── .codex-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── docs/
├── src/
│   ├── cli.ts
│   ├── server.ts
│   ├── policy/
│   ├── context/
│   ├── provenance/
│   ├── risk/
│   └── tests/
└── package.json
```

Use this when the workspace is itself the Groundwork CLI/runtime package. Do not add a `skills/groundwork` folder here; skills live in `prism-plugins`.

## AI Plugins Skill Package

```text
prism-plugins/
└── groundwork/
    ├── plugin.json
    └── skills/
        └── groundwork/
            ├── SKILL.md
            ├── capabilities.md
            ├── checklist.md
            ├── configuration.md
            ├── layouts.md
            ├── references.md
            └── snippets.md
```

Use this as the canonical home for agent-facing Groundwork usage guidance.

## Docs Or Knowledge Workspace

```text
workspace/
├── AGENTS.md
├── groundwork.toml
├── docs/
├── notes/
├── research/
├── assets/
└── archive/
```

Use this when context, policy, and retrieval matter more than build tooling.

## Mixed Workspace

```text
workspace/
├── AGENTS.md
├── groundwork.toml
├── .groundwork/
├── apps/
├── packages/
├── docs/
├── research/
└── notes/
```

Use this when one root contains both executable code and durable non-code material.

## Nested Context Rule Of Thumb

Add nested `AGENTS.md` or `CLAUDE.md` only when a subtree needs different rules, such as:

- `src/` for source-specific validation
- `research/` for citation and source-handling rules
- `contracts/` for compatibility and change-control rules
- `apps/<name>/` for app-specific commands or release rules

Do not create nested context files just to restate the root.
