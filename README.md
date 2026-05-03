# Groundwork

Groundwork is a JSON-first CLI for policy, provenance, context, and risk foundations in agentic development workflows. Codex and OpenCode integrations are thin harness layers over the same Groundwork foundations where the harness APIs allow it.

## Install Surface

The package exposes a standard `groundwork` binary:

```sh
bun install
bun run build
bun link
bun link groundwork
./node_modules/.bin/groundwork doctor
```

Packaged installs use `bin.groundwork -> dist/cli.js`. The published file surface includes `dist/`, `docs/`, `hooks/`, `skills/`, `.codex-plugin/`, and this README.

## CLI

Groundwork commands accept JSON input inline, from stdin, or from `@file` paths, and return deterministic JSON envelopes.

```sh
groundwork doctor
groundwork capabilities
groundwork schema list
groundwork examples list
groundwork risk evaluate-command '{"command":"git reset --hard"}'
groundwork policy evaluate-tool-call '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'
groundwork context touched-paths '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'
groundwork provenance read '{"path":"src/index.ts","max_bytes":4000}'
groundwork provenance run '{"tool":"gw_worktree_overview","args":{"limit":10}}'
groundwork session render-compaction '{"session_id":"codex"}'
```

Discovery commands expose supported capabilities, examples, and JSON schema contracts.

## Codex

Groundwork can be installed into Codex three ways:

```sh
groundwork codex install-project '{"target_dir":"."}'
groundwork codex install-user '{}'
groundwork codex doctor
```

The package also includes a Codex plugin bundle at `.codex-plugin/plugin.json`, with bundled `skills/groundwork/SKILL.md` and `hooks/hooks.json`.

Project and user installers patch `config.toml` to enable Codex hooks, install `hooks.json`, and install the Groundwork skill. Hooks call `groundwork codex hook` by default. If `groundwork` is not on `PATH` for hook execution, pass an explicit `hook_command`:

```sh
groundwork codex install-project '{"target_dir":".","hook_command":"/absolute/path/to/groundwork codex hook"}'
```

Codex hook parity is best effort. Current hooks cover `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop` within Codex hook API limits. They can deny supported risky commands and policy violations before execution, record explicit policy commands, persist session artifacts, and report post-tool/context feedback. They cannot intercept every tool path, undo side effects after a tool runs, or fully reproduce OpenCode synthetic prompt injection/compaction behavior.

See `docs/codex-integration.md` for details.

## OpenCode

The OpenCode entrypoint is `src/server.ts`, exported as `dist/server.js`. OpenCode keeps stronger runtime hooks for ambient behavior, while shared Groundwork services and CLI-facing foundations carry the reusable business logic. Existing OpenCode `gw_*` provenance tool IDs and hook behavior are preserved.

For local OpenCode use, point OpenCode at this package/plugin path after building:

```sh
bun run build
```

Headless validation evidence for OpenCode and Codex lives under `.agents/validation/`.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run build
bun run check:imports
bun run verify
```

`bun run verify` runs typecheck, tests, build, server import, and CLI doctor checks.

## Project Layout

- `src/cli.ts` and `src/cli/` implement the standalone CLI protocol and Codex installers/hooks.
- `src/risk/`, `src/policy/`, `src/context/`, `src/provenance/`, and `src/session/` contain the Groundwork foundations.
- `src/server.ts` exports the OpenCode plugin entrypoint.
- `.codex-plugin/`, `hooks/`, and `skills/` define the Codex plugin/install surface.
- `docs/` contains integration and session artifact notes.
- `.agents/sdlc/` tracks work items and review evidence.
