# Groundwork Checklist

## 1. Root And Taxonomy

- One stable workspace root is chosen.
- The workspace is classified as `code`, `docs`, `mixed`, `Groundwork source`, or `third-party harness`.
- The top-level folders reflect real boundaries, not accidents.

## 2. CLI Availability

- `groundwork doctor` runs from the active shell.
- `groundwork capabilities` returns the expected JSON envelope.
- The active harness can resolve the same `groundwork` binary or has an explicit command path.

## 3. Policy Foundation

- `groundwork.toml` or `.groundwork/*.toml` exists when the workspace has risky paths or guarded workflows.
- User/global policy lives under `~/.groundwork/*.toml` when needed.
- The initial rule set covers real risks, not speculative ones.
- If policy uses includes, the include graph is intentional and small enough to understand.

## 4. Context Foundation

- Root `AGENTS.md` exists.
- Nested `AGENTS.md` or `CLAUDE.md` files exist only where subtree rules differ.
- Nested context files are non-empty and non-duplicative.
- The resulting inheritance path makes sense for normal edit/read targets.

## 5. Provenance Foundation

- `gw_*` tools are available directly or through `groundwork provenance run`.
- The workspace structure is legible enough that provenance output will be meaningful.
- Compaction context is requested explicitly with `groundwork session render-compaction` where the harness does not support ambient compaction hooks.

## 6. Risk Foundation

- Destructive-command guard mode is intentionally chosen.
- Any deviation from default blocking behavior is documented.
- Bash permissions or approval settings do not silently undercut the guardrail story.
- Harnesses without pre-command hooks are taught explicit `groundwork risk evaluate-command` usage.

## 7. Harness Wiring

- OpenCode plugin wiring points at the built Groundwork package when OpenCode is the harness.
- Codex project/user hooks are installed only where trusted and useful.
- Codex skills are managed from `prism-plugins`, not written by the Groundwork package.
- Other harnesses call the CLI and consume JSON envelopes explicitly.

## 8. Docs / Knowledge Extras

- Retrieval or map tooling exists only if the workspace benefits from long-lived navigation.
- Docs, notes, research, assets, and archive folders are distinguishable.
- Policies protect source material and generated outputs where needed.

## 9. Verification

For code repos:

- run the repo's validation command
- run one targeted test when the change is Groundwork-specific
- confirm `groundwork doctor` and relevant `groundwork ...` checks pass

For docs-heavy workspaces:

- confirm context and policy files reflect reality
- confirm protected paths are the ones that actually matter

For harness integrations:

- run the harness-specific doctor command if present
- run one hook or explicit CLI path end to end

## 10. Done Criteria

The workspace is ready when:

- policy, context, provenance, and risk each have a clear place to operate
- risky paths or actions are guarded
- the root and subtree rules are easy to discover
- validation commands are obvious
- optional machinery is enabled only where it pays for itself
