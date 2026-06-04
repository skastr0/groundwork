# Groundwork for Codex

Groundwork exposes Codex support through `@skastr0/groundwork-codex`, a self-contained plugin bundle. The package ships the Codex manifest, hook definitions, platform wrappers, and bundled hook runtime from one plugin source directory.

## Install Surfaces

- Plugin package: `@skastr0/groundwork-codex`, with `.codex-plugin/plugin.json`, bundled `hooks/hooks.json`, shell and cmd wrappers in `hooks/`, and `dist/groundwork-codex-hook.mjs`.
- Local plugin source: `packages/codex`, where `.codex-plugin/plugin.json` and `hooks/hooks.json` live.
- Runtime entrypoint: `dist/groundwork-codex-hook.mjs`, invoked through `hooks/groundwork-codex-hook.sh` or `hooks/groundwork-codex-hook.cmd`.
- Runtime engine: Node >= 24.

For local development, run `bun install` and `bun run build` before installing or refreshing the plugin.

## Plugin Browser Testing

This repository includes `.agents/plugins/marketplace.json`, which points the `groundwork` plugin source at `packages/codex`.

For a local Codex plugin install from this checkout, build the workspace and add the repository root as a marketplace snapshot:

```sh
bun install
bun run build
codex plugin marketplace add /path/to/groundwork
codex plugin add groundwork@groundwork-local
```

For a Git-backed marketplace snapshot:

```sh
codex plugin marketplace add skastr0/groundwork --ref main
codex plugin add groundwork@groundwork-local
```

The marketplace entry resolves the `groundwork` plugin source to `packages/codex`, where `.codex-plugin/plugin.json`, `hooks/hooks.json`, and `dist/groundwork-codex-hook.mjs` live.

Restart Codex after changing plugin files. Codex copies local plugin sources into its plugin cache, so an already-installed plugin can keep using stale hook definitions until the marketplace/plugin is refreshed. Review and trust the plugin-bundled hooks after install or hook changes.

## Hook Behavior

The hook entrypoint supports:

- `SessionStart`: adds Groundwork CLI guidance as developer context.
- `UserPromptSubmit`: records explicit `/policy override <reason>` and `/policy skill-loaded <skills...>` commands into durable Groundwork session artifacts.
- `PreToolUse`: evaluates supported Bash risk and policy checks for supported Bash/apply_patch/Edit/Write calls, and denies only through Codex-supported `PreToolUse` denial.
- `PermissionRequest`: denies risky Bash approval requests when the shared risk guardrail blocks the command.
- `PostToolUse`: runs post-mutation policy checks and reports feedback. This does not undo side effects.
- `PostToolUse`: also reports new inherited context reminders for supported touched paths using session dedupe. This is feedback, not synthetic prompt injection.
- `Stop`: currently returns an empty JSON success object so the shared entrypoint is valid for the event without forcing continuation.

Plugin-bundled hooks use the bundled Codex hook runtime. Codex plugin-bundled hooks are non-managed hooks; after installation or hook changes, Codex skips them until the user reviews and trusts the current hook definition.

Policy hooks use the same Groundwork config chain as the CLI and OpenCode plugin because both package surfaces use the shared Groundwork foundations. Put project policy in `groundwork.toml` or `.groundwork/*.toml`, and put user/global policy in `~/.groundwork/*.toml`.

## Trust Boundaries

Codex hooks are best-effort guardrails, not a complete security boundary.

- Project-local `.codex/` hooks load only when the project is trusted by Codex.
- `PreToolUse` only intercepts supported tool paths.
- `PostToolUse` cannot undo side effects; it can only report feedback after the tool has run.
- Tool-triggered synthetic prompt injection is unsupported in Codex V1. Prompt-mode policy guidance is surfaced through explicit CLI output, static skill guidance, or user-prompt hook context, not through automatic tool-triggered prompt injection.
- Codex compaction hook parity is unsupported in V1. Use `groundwork session render-compaction` for explicit compact Groundwork context from local artifacts.
- The Groundwork readiness skill teaches explicit CLI usage for paths hooks cannot cover.
- Use `groundwork context touched-paths` explicitly when hook coverage is missing or when you need deterministic context reminder output.
- The full `gw_*` provenance registry is available through `groundwork provenance <tool-name>` commands and `groundwork provenance run`; `gw_block_read` remains an explicit blocking read command rather than a hidden policy side effect.

## Validation

Run:

```bash
bun run verify
bun run --cwd packages/codex pack:dry-run
```

The test suite covers `SessionStart` hook context, `UserPromptSubmit` policy command capture, `PreToolUse` Bash risk and policy denial, `PermissionRequest` denial, `PostToolUse` feedback, unsupported/no-config hook paths, malformed hook payloads, and package layout.
