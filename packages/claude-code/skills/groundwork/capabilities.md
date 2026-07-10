# Groundwork Capabilities

## CLI Foundation

Groundwork commands accept JSON input inline, from stdin, or from `@file` paths and return deterministic JSON envelopes.

Core discovery:

- `groundwork doctor`
- `groundwork capabilities`
- `groundwork schema list`
- `groundwork examples list`

Core evaluations:

- `groundwork risk evaluate-command '{"command":"git reset --hard"}'`
- `groundwork policy evaluate-tool-call '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'`
- `groundwork policy evaluate-tool-result '{"session_id":"codex","call_id":"tool-1","tool":"edit"}'`
- `groundwork context discover '{"target_path":"src/index.ts"}'`
- `groundwork context touched-paths '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'`
- `groundwork session render-compaction '{"session_id":"codex"}'`

Provenance:

- `groundwork provenance repo-state '{"limit":10}'`
- `groundwork provenance file-state '{"path":"src/index.ts"}'`
- `groundwork provenance read '{"path":"src/index.ts","max_bytes":4000}'`
- `groundwork provenance run '{"tool":"gw_worktree_overview","args":{"limit":10}}'`

## 1. Policy

What it provides:

- Loads project policy from `groundwork.toml` and `.groundwork/*.toml`
- Loads optional user/global policy from `~/.groundwork/*.toml`
- Supports `GROUNDWORK_POLICY_CONFIG` and `GROUNDWORK_POLICY_GLOBAL_CONFIG`
- Supports reusable policy packs through `plugin` or `plugins`
- Merges include graphs via `include` or `includes`
- Filters by tool, path, and content
- Supports content matchers using `ast_grep` and `semgrep`
- Supports actions such as `inject_prompt`, `block_tool`, `require_human_override`, `stop_session`, and `ensure_skill_loaded`
- Supports session commands: `/policy override <reason>` and `/policy skill-loaded <skill...>`

Workspace implications:

- Keep `groundwork.toml` in the root for compact policy.
- Use `.groundwork/*.toml` when policy deserves composition.

## 2. Context

What it provides:

- Discovers inherited `AGENTS.md` and `CLAUDE.md` files along the path to touched files
- Stops at the workspace root
- Prefers deeper files over parents by path position
- Surfaces bounded reminders after target-aware tools such as read, edit, write, patch, and apply_patch

Workspace implications:

- Root `AGENTS.md` should contain durable workspace-wide rules.
- Nested `AGENTS.md` or `CLAUDE.md` files should only exist at true subtree boundaries.
- Empty or redundant nested files dilute the context foundation.

## 3. Provenance

What it provides:

- Captures local traces and evidence for changed files and repository state
- Renders compact session context for explicit compaction flows
- Provides the `gw_*` evidence tool interface

`gw_*` tools by group:

- State: `gw_repo_state`, `gw_file_state`
- Lineage: `gw_span_history`
- Expand/summarize: `gw_diff_expand`, `gw_commit_materialize`, `gw_commit_expand`, `gw_pr_materialize`, `gw_pr_expand`, `gw_tree_expand`, `gw_worktree_overview`
- Score/authority: `gw_hotspots`, `gw_authority`, `gw_stability_report`
- Read surfaces: `gw_read`, `gw_block_read`

Workspace implications:

- Keep normal read/search/edit/git workflows available so evidence commands are useful.
- Use `groundwork provenance run` from harnesses that do not expose native custom tools.

## 4. Risk

What it provides:

- Evaluates shell commands before execution when the harness exposes a pre-command hook
- Blocks or warns on destructive commands such as recursive forced `rm`, `git reset --hard`, `git push --force`, destructive docker/kubectl flows, and disk-formatting commands
- Supports env configuration:
  - `GROUNDWORK_DESTRUCTIVE_GUARD_MODE=block | warn | off`
  - `GROUNDWORK_DESTRUCTIVE_GUARD_EXTENDED=true | false`
  - `GROUNDWORK_DESTRUCTIVE_GUARD_ALLOW_TMP_RM_RF=true | false`

Workspace implications:

- Default to `block` unless the workspace has a deliberate operational reason not to.
- Document any relaxation in `AGENTS.md` or infra docs.
- For harnesses without pre-command hooks, teach agents to call `groundwork risk evaluate-command` explicitly before high-risk shell commands.

## Harness Integration

OpenCode can provide stronger ambient behavior through plugin hooks and custom tools.

Codex can install project or user hooks with:

- `groundwork codex install-project '{"target_dir":"."}'`
- `groundwork codex install-user '{}'`
- `groundwork codex doctor`

Codex hooks are best effort. They can deny supported Bash/apply_patch/Edit/Write calls through `PreToolUse`, capture explicit policy commands from user prompts, and report post-tool feedback. They cannot intercept every tool path, undo side effects, or fully reproduce OpenCode synthetic prompt injection behavior.

Any other harness can integrate by calling the CLI directly and using Groundwork JSON envelopes as its contract.
