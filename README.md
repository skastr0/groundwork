# Groundwork

Groundwork is a JSON-first CLI for policy, provenance, context, and risk foundations in agentic development workflows. Codex and OpenCode integrations are thin harness layers over the same Groundwork foundations where the harness APIs allow it.

## Install Surface

The package exposes a standard `groundwork` binary:

```sh
bun install
bun run build
bun run install:local
groundwork doctor
```

`bun run build` emits both package JavaScript (`dist/server.js`, `dist/cli.js`) and standalone local CLI binaries (`dist/groundwork-<platform>-<arch>`). `bun run install:local` copies the current-platform binary to `~/.local/bin/groundwork`.

Packaged installs use `bin.groundwork -> dist/cli.js`. The published file surface includes `dist/`, `docs/`, `hooks/`, `.codex-plugin/`, and this README.

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
groundwork context discover '{"target_path":"README.md","include_root":true}'
groundwork provenance read '{"path":"src/index.ts","max_bytes":4000}'
groundwork provenance run '{"tool":"gw_worktree_overview","args":{"limit":10}}'
groundwork session render-compaction '{"session_id":"codex"}'
```

Discovery commands expose supported capabilities, examples, and JSON schema contracts.
Context discovery excludes root-level `AGENTS.md` / `CLAUDE.md` by default to preserve harness parity; pass `include_root: true` when using the CLI for workspace-root audits or root-level files.

## Policy Configuration

Groundwork-owned config paths are canonical:

- project root: `groundwork.toml`
- project config directory: `.groundwork/*.toml` policy files
- user/global config directory: `~/.groundwork/*.toml` policy files

The policy loader merges global configs first, then project configs. Later files can override earlier rules by reusing the same rule `id`.

Environment overrides use Groundwork names only:

- project: `GROUNDWORK_POLICY_CONFIG`
- global: `GROUNDWORK_POLICY_GLOBAL_CONFIG`

Use `plugins` for reusable policy packs and `include` or `includes` for local file composition. Plugin pack files such as `groundwork-effect.toml` are opt-in and are not auto-loaded merely because they live in a Groundwork directory:

```toml
version = 1
plugins = ["groundwork-effect"]
includes = [".groundwork/policy.*.toml"]

[[rules]]
id = "protect-src"
match = ["src/**"]

[[rules.actions]]
type = "block_tool"
message = "src edits require review"
```

## Codex

Groundwork can be installed into Codex three ways:

```sh
groundwork codex install-project '{"target_dir":"."}'
groundwork codex install-user '{}'
groundwork codex doctor
```

The package also includes a Codex plugin bundle at `.codex-plugin/plugin.json`, with `hooks/hooks.json`.
Bundled hooks use `groundwork` when it is available on `PATH` and fall back to `$HOME/.local/bin/groundwork`.

Project and user installers patch `config.toml` to enable Codex hooks and install `hooks.json`. Skills are managed from `ai-plugins`, not from this package. Generated hooks default to an absolute Bun executable plus the active CLI entrypoint so hook execution does not depend on shell `PATH`. Pass an explicit `hook_command` to pin a packaged binary or custom wrapper:

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
bun run build:js
bun run build:cli
bun run build
bun run install:local
bun run check:imports
bun run verify
```

`bun run verify` runs typecheck, tests, build, server import, and CLI doctor checks.

## Project Layout

- `src/cli.ts` and `src/cli/` implement the standalone CLI protocol and Codex installers/hooks.
- `src/risk/`, `src/policy/`, `src/context/`, `src/provenance/`, and `src/session/` contain the Groundwork foundations.
- `src/server.ts` exports the OpenCode plugin entrypoint.
- `.codex-plugin/` and `hooks/` define the Codex plugin/install surface.
- `docs/` contains integration and session artifact notes.
- `.agents/sdlc/` tracks work items and review evidence.
