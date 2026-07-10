# Groundwork — ground the action before you take it

Reach for Groundwork *before* the action, not after someone asks for proof: it scores a command's risk, traces a change to git evidence, and surfaces the policy you inherited. Two reflexes are non-negotiable:

- **Hard gate — before ANY destructive Bash.** Before running a command matching `rm -rf` / `git push --force` / `DROP` / `TRUNCATE` / mass-delete / schema migration, run the risk eval first and do **not** proceed on a block-once. This fires inside your command loop, before the command executes — "is this safe?" is answered by an executed score, never by your own read after the fact.
- **Block-once is a stop, not a suggestion.** Never re-run a command to force past a block-once; fix it or escalate. A continued-past-block is itself reportable — report it rather than hide it.

## Reach for it the moment you

- **are about to mutate a governed path** → after the change, evaluate the completed (post-mutation) tool call against policy and record any human override.
- **are about to assert who changed this / blame / a root cause** → trace it first; never claim provenance from memory.
- **need to understand a diff, commit, or PR** → expand it for traced provenance, not a guess.
- **are reviewing a PR or multi-commit change** → expand it *before* forming a verdict, not after.
- **ask "where's the risk / what's unstable here?"** → read the repo's hotspots, stability, and worktree state.
- **make your first edit in an unfamiliar subtree** → discover the inherited `AGENTS.md` / `CLAUDE.md` once (it dedupes per session).

## The moves

| intent | command |
|---|---|
| risk-gate a shell / Bash command (block-once state) | risk · evaluate shell-command or Bash-tool risk |
| report forcing past a block | risk · report continued-past-block |
| trace a diff / commit / PR | `gw_diff_expand` · `gw_commit_expand` · `gw_pr_expand` (`gw_commit_materialize` / `gw_pr_materialize` to fetch first) |
| trace blame / authorship / ownership of a line | `gw_span_history` · `gw_authority` |
| read repo risk | `gw_hotspots` · `gw_stability_report` · `gw_worktree_overview` |
| read a file / tree / block at a ref | `gw_read` · `gw_tree_expand` · `gw_block_read` |
| check inherited instruction files | context · discover `AGENTS.md` / `CLAUDE.md` (session-deduped) |
| evaluate / govern by policy | policy · pre-tool + post-mutation eval · record override · confirm required skills · install/refresh packs |
| get the exact invocation + contract | `groundwork capabilities` · `groundwork schema list\|show` · `groundwork examples list\|show` · `groundwork doctor` |

Don't memorize flags — the CLI is self-describing. One worked move gives you any exact invocation:

```
$ groundwork examples show <command>   # copy-pasteable invocation, JSON-first
```

(`groundwork schema list` names every command — including the risk, context, and policy verbs — so even the highest-value gate is one lookup from copy-pasteable.)

## How it changes your work

- The safety check moves *upstream* of the command: risk is an executed score in your loop, not a judgment call after the fact.
- Every provenance claim ships with a receipt — you expand the diff/commit/PR (it terminates at primary git evidence) before you say who, what, or why.
- Policy and instruction files are read, not assumed — inherited guidance before the first edit, policy eval after the mutation. Full download: the `groundwork` skill.