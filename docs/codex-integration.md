# Groundwork for Codex

Groundwork exposes Codex support through the same JSON-first CLI used by other integrations.

## Install Surfaces

- Plugin bundle: `.codex-plugin/plugin.json` with bundled `hooks/hooks.json`.
- Local marketplace: `.agents/plugins/marketplace.json` exposes this repo as a local `groundwork` plugin.
- Project install: `groundwork codex install-project '{"target_dir":"."}'`.
- User install: `groundwork codex install-user '{"codex_home":"/path/to/.codex"}'`.
- Explicit hook command install: `groundwork codex install-project '{"target_dir":".","hook_command":"/absolute/path/to/groundwork codex hook"}'`.
- Readiness check: `groundwork codex doctor`.

Project installs create:

- `.codex/config.toml`, patched to include `[features] codex_hooks = true` while preserving existing settings.
- `.codex/hooks.json` that calls `groundwork codex hook`.

User installs create:

- `$CODEX_HOME/config.toml`, patched to include `[features] codex_hooks = true` while preserving existing settings.
- `$CODEX_HOME/hooks.json` that calls `groundwork codex hook`.

By default, existing hook files are skipped. Passing `force: true` overwrites Groundwork-managed hook files, but config files are still patched instead of replaced. Groundwork skills are managed from `ai-plugins`; the Groundwork package does not write skill folders into `.codex/`.

The generated hooks call `groundwork codex hook` by default, so the hook process must have `groundwork` on `PATH`. For local development, adding this repo's `node_modules/.bin` to `PATH` is sufficient after `bun link groundwork`; packaged/global installs should provide the same binary name. When PATH cannot be guaranteed, pass `hook_command` during project or user install to write an explicit command path.

## Hook Behavior

The hook entrypoint supports:

- `SessionStart`: adds Groundwork CLI guidance as developer context.
- `UserPromptSubmit`: records explicit `/policy override <reason>` and `/policy skill-loaded <skills...>` commands into durable Groundwork session artifacts.
- `PreToolUse`: evaluates supported Bash risk and policy checks for supported Bash/apply_patch/Edit/Write calls, and denies only through Codex-supported `PreToolUse` denial.
- `PermissionRequest`: denies risky Bash approval requests when the shared risk guardrail blocks the command.
- `PostToolUse`: runs post-mutation policy checks and reports feedback. This does not undo side effects.
- `PostToolUse`: also reports new inherited context reminders for supported touched paths using session dedupe. This is feedback, not synthetic prompt injection.
- `Stop`: currently returns an empty JSON success object so the shared entrypoint is valid for the event without forcing continuation.

Hooks call `groundwork codex hook` by default, or the configured `hook_command` for project/user installs, so plugin-bundled hooks, project hooks, and user hooks share the same CLI hook entrypoint.

Policy hooks use the same Groundwork config chain as the CLI and OpenCode plugin. Put project policy in `groundwork.toml` or `.groundwork/*.toml`, and put user/global policy in `~/.groundwork/*.toml`. Legacy `.opencode/policy.toml` paths are not read.

## Trust Boundaries

Codex hooks are best-effort guardrails, not a complete security boundary.

- Project-local `.codex/` hooks load only when the project is trusted by Codex.
- `PreToolUse` only intercepts supported tool paths.
- `PostToolUse` cannot undo side effects; it can only report feedback after the tool has run.
- Tool-triggered synthetic prompt injection is unsupported in Codex V1. Prompt-mode policy guidance is surfaced through explicit CLI output, static skill guidance, or user-prompt hook context, not through automatic tool-triggered prompt injection.
- Codex compaction hook parity is unsupported in V1. Use `groundwork session render-compaction` for explicit compact Groundwork context from local artifacts.
- The ai-plugins Groundwork readiness skill teaches explicit CLI usage for paths hooks cannot cover.
- Use `groundwork context touched-paths` explicitly when hook coverage is missing or when you need deterministic context reminder output.
- The full `gw_*` provenance registry is available through `groundwork provenance <tool-name>` commands and `groundwork provenance run`; `gw_block_read` remains an explicit blocking read command rather than a hidden policy side effect.

## Validation

Run:

```bash
bun run verify
groundwork codex doctor
```

The test suite covers project/user install, `SessionStart` hook context, `UserPromptSubmit` policy command capture, `PreToolUse` Bash risk and policy denial, `PermissionRequest` denial, `PostToolUse` feedback, unsupported/no-config hook paths, and malformed hook payloads. Headless validation artifacts live under `.agents/validation/` when generated locally.
