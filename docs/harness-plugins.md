# Harness-native plugins (shipped)

Portable source lives in `prism-plugin/`. Maintainers compile with **`prism-dev package`** into **native install roots** under `packages/`. End users install those roots with each harness’s own plugin mechanism — Prism is a build tool, not a runtime requirement for Groundwork users.

## Maintainer build

```bash
bun run build
bun run install:local   # CLI used by hook wrappers
bun run plugin:package  # requires prism-dev on PATH
```

## Shipped roots (`packages/`)

| harness | path | install |
|---|---|---|
| Claude Code | `packages/claude-code` | Local skills-directory / Claude plugin (`.claude-plugin/plugin.json`) |
| Codex | `packages/codex` | Codex marketplace (`marketplace.json` → this path) |
| OpenCode | `packages/opencode-plugin` | `opencode.json` `plugin` entry → `file://…/dist/server.mjs` |
| Grok | `packages/grok` | Local Grok plugin bundle |

See `packages/INSTALL.json` after packaging.

## Source vs shipped

| layer | path | role |
|---|---|---|
| Source | `prism-plugin/` | Portable hooks/tools/skills (edit here) |
| Intermediate | `packages/harness-plugins/` | Raw `prism package` output (gitignored) |
| Shipped | `packages/<harness>/` | Native install trees (commit or release asset) |

## Runtime dependency

All compiled hooks spawn `groundwork` (CLI). Users need the Groundwork CLI installed; they do not need Prism.
