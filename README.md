# Groundwork

Groundwork is a JSON-first CLI and shared foundation layer for policy, provenance, context, risk, and session artifacts in agentic development workflows. The Bun CLI, OpenCode wrapper, and Codex plugin are published as separate packages around the same Groundwork foundations.

## Status

- Maturity: preview
- Repository visibility: private until explicit maintainer approval
- CLI package channel: npm package `@skastr0/groundwork`
- Binary command: `groundwork`
- Maintainer model: solo-maintained

The first public package release is prepared for npm but not published yet. Real publishing, tag pushes, GitHub release creation, and repository visibility changes require explicit maintainer approval.

## Package Surface

- `@skastr0/groundwork`: the root Bun CLI package. It exports the `groundwork` executable through `bin.groundwork -> dist/cli.js`.
- `@skastr0/groundwork-core`: the shared library package under `packages/core` for policy, provenance, context, risk, and session foundations.
- `@skastr0/groundwork-opencode-plugin`: the OpenCode runtime wrapper under `packages/opencode-plugin`. It uses `@skastr0/groundwork-core` and exports `dist/server.js`.
- `@skastr0/groundwork-codex`: the self-contained Codex plugin bundle under `packages/codex`. It ships `.codex-plugin/plugin.json`, `hooks/hooks.json`, shell and cmd hook wrappers, and `dist/groundwork-codex-hook.mjs`.

## CLI Install Surface

The root package exposes a standard `groundwork` binary. After the first npm publish:

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

`bun run build` emits package JavaScript for the CLI and workspace packages, plus standalone local CLI binaries (`dist/groundwork-<platform>-<arch>`). `bun run install:local` copies the current-platform binary to `~/.local/bin/groundwork`.

Packaged CLI installs use `bin.groundwork -> dist/cli.js`. The root npm package file surface includes `dist/cli.js`, `dist/metadata.js`, `docs/`, and this README. Standalone compiled binaries are source-build artifacts and are not included in the npm package.

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

The Codex plugin is published as `@skastr0/groundwork-codex`. Its package root contains `.codex-plugin/plugin.json`, lifecycle hooks in `hooks/hooks.json`, POSIX and Windows hook wrappers in `hooks/`, and the bundled hook runtime at `dist/groundwork-codex-hook.mjs`.

Codex installs plugins from a plugin source directory or marketplace entry. For local development, use the Codex package directory as the plugin source:

```sh
bun install
bun run build
# point your Codex plugin source at /path/to/groundwork/packages/codex
```

Codex plugin hooks run shell commands that invoke `node` on the bundled JavaScript file. Runtime support follows the package engine: Node >= 24.

Codex hook parity is best effort. Current hooks cover `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop` within Codex hook API limits. They can deny supported risky commands and policy violations before execution, record explicit policy commands, persist session artifacts, and report post-tool/context feedback. They cannot intercept every tool path, undo side effects after a tool runs, or fully reproduce OpenCode synthetic prompt injection/compaction behavior. Codex requires plugin-bundled hooks to be reviewed and trusted after installation or hook changes.

See `docs/codex-integration.md` for details.

## OpenCode

The OpenCode package is published as `@skastr0/groundwork-opencode-plugin`. Its runtime entrypoint is `packages/opencode-plugin/src/server.ts`, built to `packages/opencode-plugin/dist/server.js`, and it uses `@skastr0/groundwork-core` for shared Groundwork behavior.

OpenCode keeps stronger runtime hooks for ambient behavior, while shared Groundwork services and CLI-facing foundations carry the reusable business logic. Existing OpenCode `gw_*` provenance tool IDs and hook behavior are preserved.

For local OpenCode use, point OpenCode at this package/plugin path after building:

```sh
bun run build
```

## Development

Development verification expects Bun plus the optional policy matcher CLIs used by content rules:

```sh
npm install -g @ast-grep/cli@0.43.0
python3 -m pip install --user semgrep==1.159.0
```

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
bun run pack:verify
```

`bun run verify` runs typecheck, tests, build, server import, CLI doctor checks, and local install smoke tests. `bun run pack:verify` inspects all package tarballs and runs clean packed-install smoke tests without publishing.

## Release Plan

1. Keep the repository private until the public-source surface and package tarball are validated.
2. Publish the packages to npm as `@skastr0/groundwork`, `@skastr0/groundwork-core`, `@skastr0/groundwork-opencode-plugin`, and `@skastr0/groundwork-codex`; the unscoped `groundwork` package name is not the release target.
3. Keep the `groundwork` executable name through `bin.groundwork`.
4. Use CI as the release gate: `bun run verify` and `bun run pack:verify` must pass on the release commit.
5. After maintainer approval, flip repository visibility, create the release tag/GitHub release, and run the real npm publish.

## Project Layout

- `src/cli.ts` and `src/cli/` implement the standalone CLI protocol.
- `packages/core/` contains the shared Groundwork library for risk, policy, context, provenance, and session foundations.
- `packages/opencode-plugin/` contains the OpenCode runtime wrapper.
- `packages/codex/` contains the self-contained Codex plugin bundle and bundled hook runtime.
- `docs/` contains integration and session artifact notes.
