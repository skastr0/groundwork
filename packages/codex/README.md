# @skastr0/groundwork-codex

Self-contained Groundwork Codex plugin bundle.

This package ships the Codex plugin files needed for package installation:

- `.codex-plugin/plugin.json`
- `hooks/hooks.json`
- `hooks/groundwork-codex-hook.sh`
- `hooks/groundwork-codex-hook.cmd`
- `dist/groundwork-codex-hook.mjs`

Codex hooks run shell commands from `hooks/hooks.json`. The shell and cmd wrappers resolve the installed plugin root and invoke `node` on `dist/groundwork-codex-hook.mjs`.

Hook runtime support follows the package engine: Node >= 24.

Risk hooks use session-scoped block-once state for destructive Bash commands: the first exact command is denied, an exact retry warns without granting Codex permission, and post-tool feedback reports execution after a warning.

## Build

```sh
bun run --cwd packages/codex build
```

The build emits the bundled hook runtime at `packages/codex/dist/groundwork-codex-hook.mjs`.
