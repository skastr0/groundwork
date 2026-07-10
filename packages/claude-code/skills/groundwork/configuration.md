# Configuration Guidance

## 1. Establish The Root First

Pick one durable workspace root.

Do not configure a transient subdirectory if the real workspace is higher up. Policy discovery, context inheritance, and provenance paths all depend on a stable root.

## 2. Install Or Expose The CLI

The active harness must be able to run `groundwork`.

For local development in the Groundwork repo:

```sh
bun install
bun run build
bun link
bun link groundwork
groundwork doctor
```

For installed packages, use the package binary:

```sh
groundwork doctor
groundwork capabilities
```

When a hook process cannot rely on `PATH`, configure an absolute command path.

## 3. Write A Useful Root `AGENTS.md`

Capture what Groundwork cannot infer reliably:

- package manager
- validation commands
- folder boundaries
- naming conventions
- domain vocabulary
- sensitive paths
- which harnesses are expected to call Groundwork

## 4. Add Groundwork Policy

Canonical policy paths:

- project root: `groundwork.toml`
- project config directory: `.groundwork/*.toml`
- user/global config directory: `~/.groundwork/*.toml`

Env overrides:

- `GROUNDWORK_POLICY_CONFIG`
- `GROUNDWORK_POLICY_GLOBAL_CONFIG`

Start with the smallest real set of guardrails:

- secret paths
- generated outputs
- source-of-truth documents
- risky mutation surfaces
- required review steps
- required skills for special tasks

Use `plugins` for reusable policy packs and `includes` when one workspace policy deserves multiple local files.

Use `/policy override <reason>` only as an explicit human unlock, not as a convenience escape hatch.

Use `/policy skill-loaded <skill...>` only after the required skills are actually loaded.

## 5. Policy TOML Shape

Minimal rule:

```toml
version = 1

[[rules]]
id = "protect-secrets"
match = ["**/.env", "**/secrets/**"]
tools_include = ["read", "edit", "write", "apply_patch"]

[[rules.actions]]
type = "block_tool"
message = "Do not read or edit secret material without an explicit user request."
```

Composed policy:

```toml
version = 1
plugins = ["groundwork-effect"]
includes = [".groundwork/policy.*.toml"]
```

Plugin references can be absolute paths, relative paths, or bare names. Bare names such as `groundwork-effect` resolve to Groundwork plugin TOML files in the project or user `.groundwork` directories. Plugin packs are opt-in; they are not auto-loaded just because they live next to regular policy files.

The current personal baseline uses `~/.groundwork/groundwork.toml`, `~/.groundwork/semgrep/typescript-guardrails.yml`, and `~/.groundwork/groundwork-effect.toml`.

Skill-gated policy:

```toml
version = 1

[[rules]]
id = "guard-policy-edits"
match = ["groundwork.toml", ".groundwork/*.toml"]

[[rules.actions]]
type = "ensure_skill_loaded"
skills = ["groundwork"]
mode = "block"

[[rules.actions]]
type = "require_human_override"
message = "Groundwork policy edits need explicit human review."
```

## 6. Shape Context Intentionally

Use:

- one root `AGENTS.md`
- nested `AGENTS.md` or `CLAUDE.md` only where subtree rules genuinely differ

Good nested boundaries:

- `src/`
- `docs/`
- `research/`
- `contracts/`
- `apps/<name>/`

Bad nested boundaries:

- every folder “just in case”
- empty files
- copies of the root file with no real local differences

## 7. Preserve Provenance Value

Provenance pays off when the workspace is legible:

- clear folder structure
- clear validation commands
- meaningful commit history
Use explicit CLI calls where ambient harness support is missing:

```sh
groundwork provenance repo-state '{"limit":10}'
groundwork provenance run '{"tool":"gw_worktree_overview","args":{"limit":10}}'
groundwork session render-compaction '{"session_id":"codex"}'
```

## 8. Decide Risk Strictness

Default stance:

```sh
export GROUNDWORK_DESTRUCTIVE_GUARD_MODE=block
export GROUNDWORK_DESTRUCTIVE_GUARD_EXTENDED=true
export GROUNDWORK_DESTRUCTIVE_GUARD_ALLOW_TMP_RM_RF=true
```

Relax only intentionally:

- `warn` for transitional environments
- `off` only for tightly controlled environments where other controls replace it

Document the choice if it differs from default expectations.

## 9. Configure Harnesses

OpenCode:

- build the package
- point OpenCode at the Groundwork plugin entrypoint
- use OpenCode hooks/custom tools for deeper ambient behavior

Codex:

```sh
groundwork codex install-project '{"target_dir":"."}'
groundwork codex install-user '{}'
groundwork codex doctor
```

Codex installers patch `config.toml` and install `hooks.json`. They do not install skills. Use `groundwork` from `prism-plugins` for agent-facing guidance.

Other harnesses:

- teach explicit `groundwork` CLI commands
- pass JSON input
- consume JSON envelopes
- add hook calls only for supported pre/post events
