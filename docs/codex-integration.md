# Groundwork for Codex

Groundwork exposes Codex support through the same JSON-first CLI used by other integrations.

## Install Surfaces

- Plugin bundle: `.codex-plugin/plugin.json` with bundled `skills/` and `hooks/hooks.json`.
- Local marketplace: `.agents/plugins/marketplace.json` exposes this repo as a local `groundwork` plugin.
- Project install: `groundwork codex install-project '{"target_dir":"."}'`.
- User install: `groundwork codex install-user '{"codex_home":"/path/to/.codex"}'`.
- Explicit hook command install: `groundwork codex install-project '{"target_dir":".","hook_command":"/absolute/path/to/groundwork codex hook"}'`.
- Readiness check: `groundwork codex doctor`.

Project installs create:

- `.codex/config.toml`, patched to include `[features] codex_hooks = true` while preserving existing settings.
- `.codex/hooks.json` that calls `groundwork codex hook`.
- `.codex/skills/groundwork/SKILL.md`.

User installs create:

- `$CODEX_HOME/config.toml`, patched to include `[features] codex_hooks = true` while preserving existing settings.
- `$CODEX_HOME/hooks.json` that calls `groundwork codex hook`.
- `$CODEX_HOME/skills/groundwork/SKILL.md`.

By default, existing hook and skill files are skipped. Passing `force: true` overwrites Groundwork-managed hook and skill files, but config files are still patched instead of replaced.

The generated hooks call `groundwork codex hook` by default, so the hook process must have `groundwork` on `PATH`. For local development, adding this repo's `node_modules/.bin` to `PATH` is sufficient after `bun link groundwork`; packaged/global installs should provide the same binary name. When PATH cannot be guaranteed, pass `hook_command` during project or user install to write an explicit command path.

## Hook Behavior

The initial hook entrypoint supports:

- `SessionStart`: adds Groundwork CLI guidance as developer context.
- `PreToolUse` for `Bash`: evaluates the command with `groundwork:risk` rules and denies supported destructive commands.

Hooks call `groundwork codex hook` by default, or the configured `hook_command` for project/user installs, so plugin-bundled hooks, project hooks, and user hooks share the same CLI hook entrypoint.

## Trust Boundaries

Codex hooks are best-effort guardrails, not a complete security boundary.

- Project-local `.codex/` hooks load only when the project is trusted by Codex.
- `PreToolUse` only intercepts supported tool paths.
- `PostToolUse` cannot undo side effects.
- Tool-triggered synthetic prompt injection does not have OpenCode parity in Codex V1.
- The Groundwork skill teaches explicit CLI usage for paths hooks cannot cover.

## Validation

Run:

```bash
bun run verify
groundwork codex doctor
```

The test suite covers project/user install, `SessionStart` hook context, and `PreToolUse` Bash denial. Headless validation artifacts live under `.agents/validation/` when generated locally.
