# Groundwork

Groundwork is a JSON-first CLI for policy, provenance, context, and risk foundations in agentic development workflows. Codex and OpenCode integrations are thin harness layers over the same Groundwork foundations where the harness APIs allow it.

## Status

- Maturity: preview
- Repository visibility: private until explicit maintainer approval
- Package channel: npm package `@skastr0/groundwork`
- Binary command: `groundwork`
- Maintainer model: solo-maintained

The first public package release is prepared for npm but not published yet. Real publishing, tag pushes, GitHub release creation, and repository visibility changes require explicit maintainer approval.

## Install Surface

The release package exposes a standard `groundwork` binary. After the first npm publish:

```sh
npm install -g @skastr0/groundwork
groundwork doctor
```

For source builds before the first publish:

```sh
bun install
bun run build
bun run install:local
groundwork doctor
```

`bun run build` emits both package JavaScript (`dist/server.js`, `dist/cli.js`) and standalone local CLI binaries (`dist/groundwork-<platform>-<arch>`). `bun run install:local` copies the current-platform binary to `~/.local/bin/groundwork`.

Packaged installs use `bin.groundwork -> dist/cli.js`. The npm package file surface includes the package JavaScript in `dist/`, `docs/`, `hooks/`, `.codex-plugin/`, and this README. Standalone compiled binaries are source-build artifacts and are not included in the npm package.

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
Bundled hooks call `$HOME/.local/bin/groundwork` directly so hook execution does not depend on `PATH` or Bun global-link state.

Project and user installers patch `config.toml` to enable Codex hooks and install `hooks.json`. Skills are managed from Prism plugins, not from this package. Generated hooks default to an absolute Bun executable plus the active CLI entrypoint so hook execution does not depend on shell `PATH`. Pass an explicit `hook_command` to pin a packaged binary or custom wrapper:

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
bun run pack:dry-run
```

`bun run verify` runs typecheck, tests, build, server import, CLI doctor checks, and local install smoke tests. `bun run pack:dry-run` inspects the npm package contents without publishing.

## Release Plan

1. Keep the repository private until the public-source surface and package tarball are validated.
2. Publish the package to npm as `@skastr0/groundwork`; the unscoped `groundwork` package name is not the release target.
3. Keep the `groundwork` executable name through `bin.groundwork`.
4. Use CI as the release gate: `bun run verify` and `bun run pack:dry-run` must pass on the release commit.
5. After maintainer approval, flip repository visibility, create the release tag/GitHub release, and run the real npm publish.

## Project Layout

- `src/cli.ts` and `src/cli/` implement the standalone CLI protocol and Codex installers/hooks.
- `src/risk/`, `src/policy/`, `src/context/`, `src/provenance/`, and `src/session/` contain the Groundwork foundations.
- `src/server.ts` exports the OpenCode plugin entrypoint.
- `.codex-plugin/` and `hooks/` define the Codex plugin/install surface.
- `docs/` contains integration and session artifact notes.
