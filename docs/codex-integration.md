# Groundwork + Codex (via Prism)

Groundwork no longer ships a bespoke Codex marketplace package. Codex integration is the **Prism-generated** hook + MCP surface from the in-repo plugin.

## Source

- Prism plugin: `prism-plugin/`
- Portable decisions: `groundwork hook …` (durable session artifacts under `.groundwork/sessions/`)
- Provenance tools: `groundwork provenance …` lowered as Prism MCP tools

## Install / compile

From this repository (requires `prism` on PATH, ≥ 0.3.4 for hook lowerers):

```bash
bun run build
bun run install:local   # installs groundwork CLI so hooks can spawn it
prism refresh ./prism-plugin --overwrite --harness codex-cli
```

Or use the package script smoke path:

```bash
bun run plugin:compile
```

Prism patches managed Codex hooks into `config.toml` and registers the MCP server for `gw_*` tools.

## Behavioral contract (portable)

| Event | Behavior |
|---|---|
| session start | Inject Groundwork guidance (`additionalContext`) |
| prompt submit | Record `/policy override` and `/policy skill-loaded` |
| tool before | Risk block-once for shell + policy pre-eval |
| permission request | Risk gate for Bash (Codex + OpenCode) |
| tool after | Non-blocking policy/risk/context feedback |

Codex PreToolUse is shell-only upstream; file-edit pre-policy is best-effort where the harness fires hooks for edit tools.

## Override binary path

Generated hooks resolve `groundwork` from `PATH`, then `$HOME/.local/bin/groundwork`, then `GROUNDWORK_BIN`.
