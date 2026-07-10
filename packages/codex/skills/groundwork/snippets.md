# Starter Snippets

## Minimal Root `AGENTS.md`

```md
# Workspace Rules

- Package manager: bun
- Validation: `bun run verify`
- Tests: `bun run test -- <target>`
- Use nested `AGENTS.md` or `CLAUDE.md` only for real subtree rule changes
- Use `groundwork` for policy, provenance, context, and risk checks
```

Replace the commands and boundaries with the real workspace rules.

## Minimal `groundwork.toml`

```toml
version = 1

[[rules]]
id = "protect-secrets"
match = ["**/.env", "**/secrets/**"]
tools_include = ["read", "edit", "write", "apply_patch", "morph-mcp_edit_file"]

[[rules.actions]]
type = "block_tool"
message = "Do not read or edit secret material without an explicit user request."
```

Start with the smallest real risk in the workspace.

## Composed Policy

```toml
version = 1
plugins = ["groundwork-effect"]
includes = [".groundwork/policy.*.toml"]
```

Then place focused files under `.groundwork/`, such as:

```text
.groundwork/
├── policy.generated.toml
├── policy.security.toml
    └── policy.risk.toml
```

## Example Skill-Gated Policy Action

```toml
version = 1

[[rules]]
id = "guard-groundwork-policy-edits"
match = ["groundwork.toml", ".groundwork/*.toml"]

[[rules.actions]]
type = "ensure_skill_loaded"
skills = ["groundwork"]
mode = "block"

[[rules.actions]]
type = "require_human_override"
message = "Groundwork policy edits need explicit human review."
```

Confirm the required skill with `/policy skill-loaded groundwork` only after loading it.

## Risk Environment Knobs

```sh
export GROUNDWORK_DESTRUCTIVE_GUARD_MODE=block
export GROUNDWORK_DESTRUCTIVE_GUARD_EXTENDED=true
export GROUNDWORK_DESTRUCTIVE_GUARD_ALLOW_TMP_RM_RF=true
```

Leave these close to defaults unless the workspace has a deliberate operational reason.

## Codex Hook Install

```sh
groundwork codex install-project '{"target_dir":"."}'
groundwork codex doctor
```

Use an explicit hook command when `PATH` is uncertain:

```sh
groundwork codex install-project '{"target_dir":".","hook_command":"/absolute/path/to/groundwork codex hook"}'
```

## Explicit CLI Checks For Any Harness

```sh
groundwork risk evaluate-command '{"command":"git reset --hard"}'
groundwork policy evaluate-tool-call '{"session_id":"manual","tool":"edit","args":{"path":"src/index.ts"}}'
groundwork context discover '{"target_path":"src/index.ts"}'
groundwork provenance run '{"tool":"gw_worktree_overview","args":{"limit":10}}'
groundwork session render-compaction '{"session_id":"manual"}'
```
