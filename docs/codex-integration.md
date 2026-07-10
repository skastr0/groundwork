# Groundwork + Codex (native marketplace plugin)

Groundwork ships a **Codex-native plugin** compiled from the portable Prism source (`prism-plugin/`) via `prism-dev package`. Users install it the Codex marketplace way — they do **not** need Prism on their machine.

## Build (maintainers)

Requires `prism-dev` (local Prism binary with current hook lowerers):

```bash
bun run build
bun run plugin:package
```

This writes:

- intermediate Prism packages under `packages/harness-plugins/` (gitignored)
- **shippable** Codex bundle at `packages/codex/` (marketplace root)

## Install (users / local)

```bash
bun run build && bun run install:local   # groundwork CLI on PATH (hooks spawn it)
bun run plugin:package                  # if dist/plugins not already built

codex plugin marketplace add /path/to/groundwork
codex plugin add groundwork@groundwork-local
```

Marketplace catalog (`.agents/plugins/marketplace.json`) points at `packages/codex`.

## Layout (`packages/codex`)

| path | role |
|---|---|
| `.codex-plugin/plugin.json` | Codex marketplace manifest |
| `hooks/hooks.json` | SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse |
| `hooks/*.mjs` | Prism-compiled hook wrappers (`${PLUGIN_ROOT}`) |
| `skills/groundwork/` | Agent skill content |
| `mcp/` | stdio MCP server for `gw_*` tools (optional activation) |

## Runtime

Hook wrappers call the **Groundwork CLI** (`groundwork hook …`) so state stays durable under `.groundwork/sessions/`. Install the CLI (`@skastr0/groundwork` / `bun run install:local`) so hooks can resolve `groundwork` on `PATH` (or set `GROUNDWORK_BIN`).
