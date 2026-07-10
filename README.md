# Groundwork

Groundwork is a JSON-first CLI and shared foundation layer for policy, provenance, context, risk, and session artifacts in agentic development workflows. Multi-harness hooks and tools ship as an in-repo **Prism plugin** (`prism-plugin/`) that compiles to Claude, Codex, OpenCode, Grok, and other supported targets.

## Status

- Maturity: preview
- Repository visibility: private until explicit maintainer approval
- CLI package channel: npm package `@skastr0/groundwork`
- Binary command: `groundwork`
- Maintainer model: solo-maintained

The first public package release is prepared for npm but not published yet. Real publishing, tag pushes, GitHub release creation, and repository visibility changes require explicit maintainer approval.

## Package Surface

- `@skastr0/groundwork`: the root Bun CLI package. It exports the `groundwork` executable through `bin.groundwork -> dist/cli.js`.
- `@skastr0/groundwork-core`: the shared library package under `packages/core` for policy, provenance, context, risk, session foundations, and portable hook decisions.
- `prism-plugin/`: Prism plugin source (hooks, `gw_*` tools, skills, rules). Compile with `bun run plugin:compile` or `prism refresh ./prism-plugin --overwrite --harness <id>`.

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
groundwork risk evaluate-tool-call '{"session_id":"codex","call_id":"call-1","tool":"bash","command":"git reset --hard","cwd":"."}'
groundwork risk evaluate-tool-call '{"session_id":"codex","call_id":"call-2","tool":"bash","command":"git reset --hard","cwd":"."}'
groundwork risk evaluate-tool-result '{"session_id":"codex","call_id":"call-2"}'
groundwork policy evaluate-tool-call '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'
groundwork context touched-paths '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'
groundwork context discover '{"target_path":"README.md","include_root":true}'
groundwork provenance read '{"path":"src/index.ts","max_bytes":4000}'
groundwork provenance run '{"tool":"gw_worktree_overview","args":{"limit":10}}'
groundwork session render-compaction '{"session_id":"codex"}'
```

Discovery commands expose supported capabilities, examples, and JSON schema contracts.
Context discovery excludes root-level `AGENTS.md` / `CLAUDE.md` by default to preserve harness parity; pass `include_root: true` when using the CLI for workspace-root audits or root-level files.
Risk `evaluate-command` is a pure classifier. Harness-style `risk evaluate-tool-call` adds session-scoped block-once state: the first exact destructive Bash command blocks, the same exact retry warns, and `risk evaluate-tool-result` records that the warned command actually executed.

## Policy Configuration

Groundwork-owned config paths are canonical:

- project root: `groundwork.toml`
- project config directory: `.groundwork/*.toml` policy files
- project policy pack directory: `.groundwork/policies/*.toml` publishable pack files
- user/global config directory: `~/.groundwork/*.toml` policy files

The policy loader merges global configs first, then project configs. Later files can override earlier rules by reusing the same rule `id`.

Environment overrides use Groundwork names only:

- project: `GROUNDWORK_POLICY_CONFIG`
- global: `GROUNDWORK_POLICY_GLOBAL_CONFIG`

Use `plugins` for reusable policy packs and `include` or `includes` for local file composition. Plugin pack files such as `groundwork-effect.toml` are opt-in and are not auto-loaded merely because they live in a Groundwork directory. Repositories can publish packs under `.groundwork/policies/*.toml`; consumers activate them explicitly with `plugins` or install them into a local plugin directory with `groundwork policy install`.

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

Git-backed policy pack distribution is install/update-time only. Hooks never fetch network policy sources. `policy install` clones or fetches the Git source, validates discovered `.groundwork/policies/*.toml` files, materializes selected packs into `~/.groundwork/plugins/<name>.toml` by default, and records source and lock metadata in `~/.groundwork/policy.sources.json` and `~/.groundwork/policy.lock.json`.

```sh
groundwork policy install '{"url":"https://github.com/skastr0/groundwork.git","ref":"main","name":"groundwork-effect","scope":"global"}'
groundwork policy update '{"names":["groundwork-effect"],"scope":"global"}'
```

Use `"scope":"project"` with `"root_dir":"/path/to/repo"` to install into that repository's `.groundwork/plugins` and project-local policy source/lock files instead.

## Prism harness plugin

Harness integration is owned by `prism-plugin/`. Hooks spawn the Groundwork CLI (`groundwork hook …`) so decisions stay durable on disk and lower to every Prism-supported harness from one source.

```sh
bun install
bun run build
bun run install:local
prism refresh ./prism-plugin --overwrite --harness codex-cli
prism refresh ./prism-plugin --overwrite --harness opencode
prism refresh ./prism-plugin --overwrite --harness claude-code
# or: bun run plugin:compile
```

Portable decisions (also used by generated wrappers):

```sh
groundwork hook session-start '{}'
groundwork hook tool-before '{"tool_name":"Bash","args":{"command":"git push --force origin main"}}'
```

See `docs/codex-integration.md` for Codex-oriented install notes.

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
2. Publish the packages to npm as `@skastr0/groundwork` and `@skastr0/groundwork-core`; the unscoped `groundwork` package name is not the release target. Harness plugins are distributed via Prism compile of `prism-plugin/`.
3. Keep the `groundwork` executable name through `bin.groundwork`.
4. Use CI as the release gate: `bun run verify` and `bun run pack:verify` must pass on the release commit.
5. After maintainer approval, flip repository visibility, create the release tag/GitHub release, and run the real npm publish.

## Project Layout

- `src/cli.ts` and `src/cli/` implement the standalone CLI protocol (including `hook` decisions).
- `packages/core/` contains the shared Groundwork library for risk, policy, context, provenance, session foundations, and portable hook runtime.
- `prism-plugin/` contains Prism hooks, `gw_*` tools, skills, and rules for multi-harness distribution.
- `docs/` contains integration and session artifact notes.
