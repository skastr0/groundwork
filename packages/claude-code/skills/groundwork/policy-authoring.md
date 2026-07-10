# Groundwork Policy Authoring

Groundwork policy is TOML with a small schema and deterministic merge behavior. Use it to encode guardrails that should travel across Codex, OpenCode, and any harness that calls the `groundwork` CLI.

## File Locations

Canonical policy locations:

- project root: `groundwork.toml`
- project policy directory: `.groundwork/*.toml`
- user/global policy directory: `~/.groundwork/*.toml`

Environment overrides:

- `GROUNDWORK_POLICY_CONFIG`
- `GROUNDWORK_POLICY_GLOBAL_CONFIG`

The loader merges user/global policy first, then project policy. Later files can override earlier rules by reusing the same rule `id`.

## Schema

```toml
version = 1

# Optional reusable packs.
plugins = ["groundwork-effect"]

# Optional local composition.
includes = [".groundwork/policy.*.toml"]

[[rules]]
id = "rule-id"
description = "Optional human-readable intent"
severity = "warn"
match = ["src/**"]
tools_include = ["edit", "write", "apply_patch"]
tools_exclude = ["read"]
scope = "changed_lines"
content_mode = "any"

[[rules.content]]
type = "ast_grep"
language = "ts"
pattern = "console.log($$$ARGS)"

[[rules.actions]]
type = "inject_prompt"
text = "Review console logging before finishing."
once_per_session = true
```

Required fields:

- `version = 1`
- each rule needs `id`, `match`, and at least one action

Optional rule fields:

- `description`
- `severity = "advisory" | "warn" | "block" | "terminate"`
- `tools_include`
- `tools_exclude`
- `scope = "changed_lines" | "full_file"`
- `content_mode = "any" | "all"`
- `content`

## Plugins

Use `plugins` for reusable policy packs.

```toml
version = 1
plugins = ["groundwork-effect"]
```

Plugin references can be:

- bare names: `groundwork-effect`
- relative paths: `.groundwork/local-pack.toml`
- absolute paths: `/Users/me/.groundwork/work-pack.toml`

Bare names resolve to Groundwork plugin TOML files in project and user `.groundwork` locations. This lets a project opt into standard packs without copying their rules. Plugin pack files such as `groundwork-effect.toml` are opt-in and are not auto-loaded merely because they live in a Groundwork directory.

Canonical personal packs created by the current Groundwork setup:

- `~/.groundwork/groundwork.toml` for baseline TypeScript policy
- `~/.groundwork/semgrep/typescript-guardrails.yml` for TypeScript Semgrep rules
- `~/.groundwork/groundwork-effect.toml` for reusable Effect guidance

Use plugins for durable, reusable rule families such as TypeScript fundamentals, Effect idioms, security baselines, or agentic CLI authoring expectations. Use `includes` for local files that belong only to one workspace.

## Includes

Use `includes` to split one policy into local files:

```toml
version = 1
includes = [".groundwork/policy.*.toml"]
```

Includes can be relative paths, absolute paths, or glob patterns. Keep include graphs shallow and obvious.

## Actions

### `inject_prompt`

Use for contextual guidance.

```toml
[[rules.actions]]
type = "inject_prompt"
text = "API change detected. Check compatibility and update docs."
once_per_session = true
```

### `block_tool`

Use for hard stops.

```toml
[[rules.actions]]
type = "block_tool"
message = "Secret material is blocked. Use a secret manager."
```

### `require_human_override`

Use when a human must explicitly unlock the next action.

```toml
[[rules.actions]]
type = "require_human_override"
message = "Production config changes need explicit human approval."
```

### `ensure_skill_loaded`

Use when a task should load a specific skill first.

```toml
[[rules.actions]]
type = "ensure_skill_loaded"
skills = ["groundwork"]
mode = "prompt"
once_per_session = true
```

`mode = "prompt"` allows the tool call and emits guidance. `mode = "block"` blocks until the skill is confirmed with `/policy skill-loaded <skill...>`.

### `stop_session`

Use sparingly for critical violations.

```toml
[[rules.actions]]
type = "stop_session"
message = "Direct production shell access is prohibited."
```

## Content Matchers

### ast-grep

```toml
[[rules.content]]
type = "ast_grep"
language = "ts"
pattern = "Effect.runPromise($$$ARGS)"
```

### Semgrep

```toml
[[rules.content]]
type = "semgrep"
configs = ["~/.groundwork/semgrep/typescript-guardrails.yml"]
include_rule_ids = ["typescript.no-as-any"]
```

Use `scope = "changed_lines"` to focus content checks on new edits. Use `scope = "full_file"` when the rule cares about the whole target file.

Use `content_mode = "any"` when any matcher may trigger the rule. Use `content_mode = "all"` when every matcher must match.

## Session Commands

Agents can record policy state through explicit prompt commands:

```text
/policy override reviewed by human
/policy skill-loaded groundwork forge
```

Overrides and skill confirmations are session-scoped Groundwork artifacts.

## Examples

### Secrets

```toml
version = 1

[[rules]]
id = "block-secret-files"
match = ["**/.env*", "**/secrets/**", "**/*.key", "**/*.pem", "**/credentials*"]
tools_include = ["read", "edit", "write", "grep"]

[[rules.actions]]
type = "block_tool"
message = "Secret material is blocked. Use 1Password CLI or another secret manager."
```

### Effect Pack Opt-In

```toml
version = 1
plugins = ["groundwork-effect"]
```

This resolves to `groundwork-effect.toml` in the project or user `.groundwork` directory. Add project-specific rules only when the workspace needs extra local guidance:

```toml
version = 1
plugins = ["groundwork-effect"]

[[rules]]
id = "project-effect-boundary"
match = ["src/**"]

[[rules.actions]]
type = "inject_prompt"
text = "This project uses Effect. Keep effects in the typed error channel and run them only at explicit boundaries."
once_per_session = true
```
