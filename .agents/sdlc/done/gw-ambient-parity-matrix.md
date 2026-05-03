# Groundwork ambient parity matrix

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-ambient-parity-matrix

## Context

Groundwork currently has ambient OpenCode behavior through runtime hooks: system guidance, tool definition augmentation, before/after tool enforcement, context injection, provenance capture, compaction context, and risk blocking. The CLI-first direction requires making each ambient behavior explicit and deciding whether Codex can preserve it through hooks, config, skills, CLI commands, or not at all.

## Acceptance Criteria

- [x] AC-1: Inventory every current OpenCode hook and ambient behavior in Groundwork.
- [x] AC-2: For each behavior, map the required input data, side effect, and blocking/injection semantics.
- [x] AC-3: For Codex, classify each behavior as `hook`, `skill`, `config`, `explicit-cli`, `unsupported`, or a hybrid.
- [x] AC-4: Document hook limitations and residual risks for safety/policy claims.
- [x] AC-5: Produce implementation follow-up items for each behavior that should be preserved.

## Notes

[2026-05-03]: This item should precede aggressive Codex hook work. The goal is to avoid assuming OpenCode hook parity exists in Codex.

## Current OpenCode Ambient Inventory

Groundwork currently uses the OpenCode server plugin surface:

- `chat.message`: policy command intake for `/policy override` and `/policy skill-loaded`.
- `tool.execute.before`: policy preflight, context pending-target capture, provenance pending capture, and risk blocking.
- `tool.execute.after`: policy post-mutation checks, context reminder injection, and provenance trace persistence.
- `tool.definition`: provenance guidance appended to built-in tool descriptions.
- `event`: session cleanup on `session.deleted`.
- `experimental.chat.system.transform`: global Groundwork system reminders.
- `experimental.session.compacting`: compacted Groundwork state injected into compaction context.
- `tool`: `gw_*` custom tools for explicit provenance queries.

## Codex Hook Contract Summary

Codex hooks are config/plugin lifecycle command hooks, not a full OpenCode-style runtime SDK.

- `SessionStart`: can add extra developer context through plain text or `hookSpecificOutput.additionalContext`.
- `UserPromptSubmit`: can add extra developer context or block a prompt.
- `PreToolUse`: intercepts supported Bash, `apply_patch`, edits, and MCP tools before execution; can deny supported calls.
- `PermissionRequest`: can allow/deny approval requests; deny wins across hooks.
- `PostToolUse`: observes supported tools after execution and can replace tool feedback, but cannot undo side effects.
- `Stop`: can request continuation, useful for review/verification nudges.

Known limits from the local Codex hook contract reference:

- Hooks are guardrails, not a complete security boundary.
- `PreToolUse` does not intercept all shell paths, WebSearch, or every non-shell/non-MCP tool.
- Several parsed fields fail open today: `updatedInput`, `additionalContext` on `PreToolUse`, `continue: false` for some events, and `suppressOutput`.
- Project hooks only load for trusted projects.
- Plugin-bundled hooks are a distribution surface, but user/project config-layer hooks are the safer activation target to verify.

## Parity Matrix

| Groundwork behavior | OpenCode mechanism | Required input/state | Codex strategy | Classification | Residual risk |
|---|---|---|---|---|---|
| Global Groundwork reminders | `experimental.chat.system.transform` | none beyond active session | `SessionStart` hook emits developer context; bundled skill repeats rules | `hook + skill` | SessionStart context may not update mid-session; skill adherence is model-dependent |
| Context file discovery for touched files | `tool.execute.before/after` + `client.session.prompt` | tool name, target paths, session prompt context, injected-file dedupe state | `PreToolUse`/`PostToolUse` can call `groundwork context discover`; `SessionStart` can add generic instruction to run CLI for touched paths | `hook + skill + explicit-cli` | Codex cannot reliably inject a synthetic prompt after every tool call; dedupe/session state needs local artifacts |
| Policy command intake | `chat.message` parses `/policy ...` | user message parts, session locks/state | `UserPromptSubmit` can inspect prompt and add/block context; explicit `groundwork policy ...` commands preferred | `hook + explicit-cli` | No direct mutable session lock equivalent unless persisted in Groundwork artifact store |
| Policy preflight blocking | `tool.execute.before` throws `FrameworkEnforcementError` | tool name, args, extracted paths, policy config, session state | `PreToolUse` for Bash/apply_patch/Edit/Write/MCP calls invokes `groundwork policy evaluate-tool-call`; deny where supported | `hook` | Coverage limited to supported Codex hook tools; path extraction depends on Codex `tool_input` shape |
| Policy post-mutation checks | `tool.execute.after` snapshots before and evaluates after | pending target snapshots, after file state, policy config | `PostToolUse` can run checks and report/replace tool feedback; cannot undo changes | `hook + explicit-cli` | Side effects have already happened; use as feedback/stop, not prevention |
| Policy pre-tool synthetic guidance | `tool.execute.before` rule actions call `client.session.prompt` for `inject_prompt` and prompt-mode `ensure_skill_loaded` | matched rule, action text, session/action dedupe state | No equivalent for tool-triggered synthetic prompt injection in V1; provide static skill guidance plus explicit `groundwork policy evaluate-tool-call` output | `unsupported-v1 + skill + explicit-cli` | Codex `PreToolUse` cannot add context today; do not claim ambient prompt parity for tool-triggered guidance |
| Policy post-tool feedback | `tool.execute.after` rule actions can call `client.session.prompt` after observing a tool result | matched rule, tool result, mutated paths, session/action dedupe state | `PostToolUse` can run `groundwork policy evaluate-tool-result` and replace/report tool feedback | `hook + explicit-cli` | Feedback happens after side effects; cannot force model to internalize it as a synthetic user prompt |
| Policy prompt/user command handling | `chat.message` and policy prompt text | user message parts, explicit override/confirmation commands | `UserPromptSubmit` can inspect user prompts; explicit CLI commands persist overrides/confirmations | `hook + explicit-cli` | Only user-submitted prompt flow is covered; tool-triggered prompts remain unsupported |
| Human override lock | session kernel locks + `/policy override` | session id, rule id, override reason | Store override artifacts under `.groundwork/session/<id>` via CLI; `UserPromptSubmit` recognizes override prompts | `hook + explicit-cli` | Requires durable session-id mapping and cleanup strategy |
| Required skill confirmation intake | `/policy skill-loaded` updates policy runtime confirmedSkills | session id, skill names | `UserPromptSubmit` or `groundwork policy skill-loaded` persists confirmation artifacts | `hook + explicit-cli` | Current hook payload does not expose loaded-skill set; confirmation is self-reported unless Codex exposes skill metadata later |
| Required skill enforcement | `ensure_skill_loaded` non-prompt mode calls `enforceViolation` from before/after policy phases | matched rule, missing skill names, mode, tool call, session confirmation state | `PreToolUse` can deny supported tool calls when required confirmation is absent; `PostToolUse` can report missed enforcement after supported tools | `hook + explicit-cli` | Only supported tool calls can be blocked; unsupported tools and prompt-only actions cannot preserve OpenCode behavior |
| Risky Bash blocking | `tool.execute.before` for `bash` | command string | `PreToolUse` matcher `Bash` invokes `groundwork risk evaluate-command` and denies on violation; `PermissionRequest` can deny escalations too | `hook` | Does not cover shell paths outside Codex hook support |
| Provenance tool definition guidance | `tool.definition` mutates descriptions | tool id | Encode in bundled Groundwork skills and examples; `capabilities`/`schema` advertise CLI commands | `skill` | Cannot rewrite built-in tool descriptions generically in Codex |
| Ambient provenance capture | `tool.execute.before/after` captures read/edit/bash/task evidence | tool name, args, output, session id, line ranges | `PreToolUse`/`PostToolUse` write best-effort trace records for supported tools; explicit CLI commands for authoritative queries | `hook + explicit-cli` | Coverage is incomplete; trace fidelity varies by tool payload |
| Compaction context | `experimental.session.compacting` | session kernel state | `Stop` hook can ask for continuation if validation missing; explicit `groundwork context render` later | `explicit-cli + hook` | No direct compaction context hook equivalent |
| Session cleanup | `event session.deleted` | session id | CLI artifact retention policy and optional `Stop`/future cleanup command | `unsupported-v1` | No deletion event in current Codex hook contract |
| `gw_*` custom tools | OpenCode `tool` registry | shell/rootDir and tool args | Groundwork CLI commands listed in the tool parity table below | `explicit-cli` | Requires skills to teach CLI usage; no MCP needed for V1; several tools still need CLI equivalents |

## `gw_*` Tool CLI Parity Table

| OpenCode tool | Current category | Target CLI command | V1 status | Gap / note |
|---|---|---|---|---|
| `gw_repo_state` | state | `groundwork provenance repo-state` | implemented | Keep OpenCode wrapper compatible with CLI output shape |
| `gw_file_state` | state | `groundwork provenance file-state` | implemented | Keep OpenCode wrapper compatible with CLI output shape |
| `gw_span_history` | lineage | `groundwork provenance span-history` | follow-up | Needs CLI schema and tests around line range inputs |
| `gw_diff_expand` | expand | `groundwork provenance diff-expand` | follow-up | Needs diff/patch payload contract |
| `gw_commit_materialize` | expand | `groundwork provenance commit-materialize` | follow-up | Needs git object materialization contract |
| `gw_commit_expand` | expand | `groundwork provenance commit-expand` | follow-up | Needs commit expansion contract |
| `gw_pr_materialize` | expand | `groundwork provenance pr-materialize` | follow-up | Needs provider/remote inputs and offline behavior |
| `gw_pr_expand` | expand | `groundwork provenance pr-expand` | follow-up | Needs provider/remote inputs and pagination/error policy |
| `gw_tree_expand` | expand | `groundwork provenance tree-expand` | follow-up | Needs tree path/depth contract |
| `gw_worktree_overview` | query | `groundwork provenance worktree-overview` | follow-up | Overlaps with repo-state but currently separate user affordance |
| `gw_hotspots` | score | `groundwork provenance hotspots` | follow-up | Needs scoring config schema |
| `gw_authority` | score | `groundwork provenance authority` | follow-up | Needs authorship/authority scoring config schema |
| `gw_stability_report` | score | `groundwork provenance stability-report` | follow-up | Needs report contract and limits |
| `gw_read` | query/read | `groundwork provenance read` | follow-up | Needs read-range schema and output parity |
| `gw_block_read` | query/read + enforcement | `groundwork provenance block-read` or policy-backed hook command | follow-up | Different from normal read: must preserve blocking semantics or be explicitly downgraded |

## Follow-Up Work Items

- `gw-codex-integration`: implement Codex plugin, bundled skills, install modes, and `groundwork codex doctor`.
- `gw-codex-hook-scripts`: implement Codex `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop` scripts around the CLI, with explicit tests for unsupported prompt-injection parity.
- `gw-policy-cli`: add `groundwork policy evaluate-tool-call`, `evaluate-tool-result`, `override`, and `skill-loaded` commands with hook-friendly JSON payloads.
- `gw-session-artifacts`: define `.groundwork/` session artifact storage for overrides, skill confirmations, prompt/action dedupe, pending tool snapshots, trace state, and retention cleanup.
- `gw-provenance-cli-parity`: add CLI equivalents and tests for every `gw_*` tool in the parity table, including an explicit decision for `gw_block_read` semantics.
- `gw-context-hook-state`: preserve context discovery/dedupe behavior through CLI artifacts and Codex hook scripts where possible.
- `gw-compaction-render`: add an explicit context/compaction render command and document that Codex has no direct OpenCode `experimental.session.compacting` equivalent.
- `gw-opencode-thin-wrapper`: progressively make OpenCode hooks/tools call shared CLI/core behavior while preserving OpenCode-only affordances.

## Evidence

[2026-05-03]: Used current local Codex hook reference at `/Users/guilhermecastro/.codex/skills/codex-configuration/references/hooks-contracts.md`. Key contract details: supported events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop`; `PreToolUse` can deny supported Bash/apply_patch/Edit/Write/MCP calls; `PostToolUse` cannot undo side effects; project hooks require trusted projects; hooks are not a complete enforcement boundary.
[2026-05-03]: Reviewer found the first matrix overclaimed tool-triggered prompt injection parity, under-specified required-skill blocking, collapsed `gw_*` tool coverage, and used umbrella follow-ups. Revised rows now split pre-tool synthetic guidance, post-tool feedback, and prompt/user command handling; split skill confirmation from enforcement; added per-tool CLI parity table; and added behavior-specific follow-up items.
[2026-05-03]: Re-review PASS. Reviewer confirmed the previous findings were resolved and no blocking correctness or completeness issues remain for this planning artifact.
