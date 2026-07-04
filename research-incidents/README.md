# research-incidents

This directory holds corpus-derived policy candidates mined from **13,433 agent sessions** (7,533 substantive) stored in Quasar. The goal is to turn recurring incident patterns into enforceable Groundwork policy rules.

The work is staged as:

- **Mining pipeline** — `.groundwork/mining-swarm/`
  - `phase1/` — raw corpus lenses and hygiene denominators.
  - `phase3/merged-candidates.json` — merged, de-duplicated candidate rules with receipts.
  - `phase5/ranked-packs.json` — ranked policy packs with verdicts, coverage, and draft rules.
- **Policy drafts** — this directory
  - `shippable-now/` — rules that map to Groundwork's current rule schema.
  - `proposed-message-rules/` — rules that need new message/stop-gate runtime support.
  - `proposed-command-rules/` — rules that need new Bash command-matching runtime support.
  - `tests/` and `fixtures/` — test runner and ast-grep fixtures for the shippable-now rules.

> **Honest state:** `shippable-now/` contains 9 TOML files with 10 rules that parse against the current Groundwork policy schema. `proposed-message-rules/` and `proposed-command-rules/` contain research drafts for runtime surfaces that do not exist yet. The canonical receipts for all candidates remain in `phase5/ranked-packs.json`.

## Matching matrix

| Policy area | What we want to match | What Groundwork can match today | Gap | Where the draft lives |
|---|---|---|---|---|
| **Provenance / read-before-act** | Edits to skills, agent abstractions, CLI docs, configs, deployment topology, modelspace refs | File-path globs (`match`), `tools_include`/`tools_exclude`, `ast_grep`/`semgrep` content matchers, and `inject_prompt` actions | None for these rules — they already fit the current `[[rules]]` schema | `research-incidents/shippable-now/` |
| **Worklist triggers** | User message shape: conjunctions of distinct actions, enumerated lists, dependent chains, follow-up complaints, read-then-act | No user-message matcher exists | Needs a `SessionStart`/`PreToolUse` hook that can evaluate `user_message` conditions and require explicit worklist acknowledgement before any tool runs | `research-incidents/proposed-message-rules/` |
| **Completion claim verification** | Assistant claims like "done", "fixed", "tests pass" without a recent verification run | No assistant-message matcher and no queryable inter-tool sequence model | Needs a `Stop`/turn-end hook with regex over assistant text, plus the ability to check whether a test/typecheck/lint/build ran after the last file mutation | `research-incidents/proposed-message-rules/` |
| **Destructive / privileged commands** | Bash command strings such as `git reset --hard`, `rm -rf`, `npm publish`, `kill -9`, SQL `DROP TABLE` | Rules match file paths, not command payloads | Needs a `PreToolUse` command matcher (e.g. `match_command`) against the `Bash` tool argument, with `block`/`require_human_override` actions | `research-incidents/proposed-command-rules/` |
| **Content / style guardrails** | Code patterns: compat/legacy layers, secret logging, provider fallbacks, project-management leaks | File-path globs + `ast_grep`/`semgrep`; `block_tool`, `require_human_override`, `inject_prompt` | Patterns are broad or doctrine-shaped; several candidates were demoted or marked `needs-work`/`watch` for false-positive or tier-fit reasons, not because runtime primitives are missing | `research-incidents/shippable-now/` after tuning, or retained in ranked-packs |

### What "shippable now" really means

- **Ready to load today:** the **Provenance Before Diagnosis** pack (`provenance-before-diagnosis`). Its rules are plain `[[rules]]` blocks with `match` paths and `inject_prompt` actions.
- **Policy-shaped but not loadable today:** **Worklist Trigger** and **Verify Before Claim** packs. They are structurally sound but require new runtime surfaces for messages and stop gates.
- **Command-shaped but not loadable today:** **Destructive Command** pack. It requires a command matcher that does not exist yet.
- **Syntax-ready but needing refinement:** **No Compat Fallback**, **Cli Integrity**, **Execution Discipline**, and **Integration Agent Hygiene**. Groundwork can express them, but the ranked review judged them `needs-work` or `watch` due to precision, false-positive surface, or project-specific doctrine concerns.

## How to use the shippable-now policies

1. Copy or symlink the desired TOML files from `research-incidents/shippable-now/` into `.groundwork/policies/`.
2. Make sure the files are loaded. Groundwork auto-discovers `.groundwork/*.toml`; for a dedicated `.groundwork/policies/` directory add an include to `groundwork.toml`:

   ```toml
   includes = [".groundwork/policies/*.toml"]
   ```

3. Validate the loaded configuration.
   - The intended command is `groundwork policy test`.
   - **Current CLI note:** `groundwork policy test` does not exist yet. For now exercise a rule with:

     ```bash
     groundwork schema show policy evaluate-tool-call
     groundwork policy evaluate-tool-call --input '{"tool":"Write","normalized_paths":["docs/skill.md"],...}'
     ```

     or run the repository test suite:

     ```bash
     bun run test
     ```

4. If a rule fires where it should not, capture the session id and sequence and open a research-incident record so the pattern can be tuned.

## How to evolve proposed policies

### Message rules

Message rules need runtime support that Groundwork does not yet expose:

- A `SessionStart` hook that receives the user's first message and can run matchers against it.
- A `PreToolUse` hook that can inspect the *current* user message, not just tool arguments.
- A small condition language (or regex/structured patterns) for message shapes: conjunctions, enumerated markers, dependency chains, follow-up complaint indicators.
- Actions that can pause execution and require an explicit worklist acknowledgement (`require = "explicit_worklist_ack"`, `split_conjunctions`, etc.).

### Stop-gate / completion rules

The **Verify Before Claim** rule is a stop gate:

- A `Stop` or turn-end hook that inspects the assistant's outgoing message.
- Regex matching over assistant text for completion words (`done`, `fixed`, `complete`, `verified`, `tests pass`, `shipped`, `working`).
- Access to a structured, queryable tool-call history so the rule can find the last mutation and check whether a verification command ran between that mutation and the claim.
- A `require_human_override` action that blocks the response unless the condition is satisfied.

### Command rules

Command rules need a new matcher in the policy rule schema:

- `match_command` (regex) evaluated against the command string inside a `Bash` tool call at `PreToolUse`.
- Clear precedence with existing `match` (file path) and `tools_include` matchers: command rules should fire when the tool is `Bash` and the command argument matches.
- Support for the same action set used elsewhere: `block`, `require_human_override`, `warn`.

None of these require changes to the file-path/content rule engine; they are additive runtime surfaces.

## Summary stats

| Metric | Value | Source |
|---|---|---|
| Total sessions mined | 13,433 | `.groundwork/mining-swarm/phase1/hygiene.json` |
| Sessions included in analysis | 13,425 | `.groundwork/mining-swarm/phase1/hygiene.json` |
| Substantive sessions | 7,533 | `.groundwork/mining-swarm/phase1/hygiene.json` |
| Merged candidates | 40 | `.groundwork/mining-swarm/phase3/merged-candidates.json` |
| Ranked policy packs | 8 | `.groundwork/mining-swarm/phase5/ranked-packs.json` |
| Candidate-level sessions intercepted | 104 | Sum of `counterfactualCoverage.sessionsIntercepted` across packs |
| Unique sessions with receipts | 78 | Unique `sessionId` values across all candidate receipts |
| Total receipts | 117 | `.groundwork/mining-swarm/phase3/merged-candidates.json` |
| Candidates passing review | 22 | `.rankedPacks.stats.passed` |
| Candidates needing work | 12 | `.rankedPacks.stats.needsWork` |
| Demoted to doctrine | 6 | `.rankedPacks.stats.demoted` / `.rankedPacks.demotionList` |

Pack verdicts:

- `ship`: Worklist Trigger, Provenance Before Diagnosis, Verify Before Claim
- `needs-work`: Destructive Command, No Compat Fallback, Cli Integrity
- `watch`: Execution Discipline, Integration Agent Hygiene

## Receipt provenance

Every candidate is backed by verbatim session receipts: `sessionId`, `seq` (or `toolSeq`), provider, and the actual command/text that triggered the candidate.

The authoritative source is:

```text
.groundwork/mining-swarm/phase5/ranked-packs.json
```

Each pack lists its `counterfactualCoverage` and its candidate ids; each candidate's receipts are in `.groundwork/mining-swarm/phase3/merged-candidates.json` keyed by `id`. If you change a rule, replay against those exact `sessionId:seq` pairs to prove the change still fires where intended and does not fire where it should not.
