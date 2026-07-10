---
name: groundwork
description: Configure, audit, or repair Groundwork policy, provenance, context, and risk foundations through the JSON-first groundwork CLI and thin harness integrations. Use when writing Groundwork policy TOML, setting up Codex or OpenCode hooks, teaching another harness to call Groundwork, or diagnosing missing Groundwork behavior.
---

# Groundwork

Use this skill when a user wants a workspace to use Groundwork, not just general agent conventions.

Groundwork is CLI-first. The `groundwork` binary owns the business logic for policy, provenance, context, session artifacts, and destructive-command risk. Harness integrations such as OpenCode and Codex should stay thin: they call the CLI or shared package entrypoints where their hook APIs allow it.

## What Ready Means

A ready workspace gives each Groundwork foundation a clear place to operate:

- **policy** loads `groundwork.toml`, `.groundwork/*.toml`, or `~/.groundwork/*.toml` and enforces real guardrails.
- **context** discovers meaningful `AGENTS.md` and `CLAUDE.md` files for inherited workspace guidance.
- **provenance** exposes `gw_*` evidence tools and captures trustworthy local repository/session context.
- **risk** evaluates destructive shell commands before execution where the harness exposes a hook.
- **harness wiring** is explicit: Codex/OpenCode hooks are useful, but any program can call the CLI directly.

## Capability Map

- **Core capabilities**: see [capabilities.md](capabilities.md)
- **Configuration and rollout guidance**: see [configuration.md](configuration.md)
- **Policy authoring**: see [policy-authoring.md](policy-authoring.md)
- **Checklist**: see [checklist.md](checklist.md)
- **Example layouts**: see [layouts.md](layouts.md)
- **Starter snippets**: see [snippets.md](snippets.md)
- **Source-of-truth references**: see [references.md](references.md)

## First Classify The Workspace

- **Code repo**: prioritize validation commands, Groundwork config, provenance, risk, and hook installation.
- **Docs or knowledge folder**: prioritize root guidance, policy, and optional retrieval/indexing tools.
- **Mixed workspace**: establish one root, then separate code and durable docs into explicit subtrees.
- **Groundwork source repo**: treat it as the CLI/runtime package; do not add a skill folder inside it.
- **Third-party harness**: teach the harness explicit `groundwork` CLI calls and add hooks only for events the harness truly exposes.

## Minimum Complete Setup

Always establish these first:

1. Confirm one stable workspace root.
2. Add a root `AGENTS.md` with package manager, validation commands, folder boundaries, and local conventions.
3. Add `groundwork.toml` or `.groundwork/*.toml` when the workspace contains risky material, sensitive paths, or required review steps.
4. Install or expose the `groundwork` CLI so the active harness can call it.
5. Install harness hooks only where useful: OpenCode has deeper ambient hooks; Codex hooks are best effort.
6. Add nested `AGENTS.md` files only at real boundary changes.
7. Keep agent-facing skills in `prism-plugins`, not in the Groundwork runtime repo.

## Foundation Priorities

Configure in this order:

1. **Policy**: decide what must be blocked, reviewed, or skill-gated.
2. **Context**: write inherited instructions that should be discovered by path.
3. **Provenance**: keep permissions and workflow structure rich enough that `gw_*` tools pay off.
4. **Risk**: keep destructive-command protection on unless there is a deliberate reason to soften it.

## Companion Skills

Use these alongside this skill when depth is needed:

- `agents-md-author` for strong root and nested `AGENTS.md` files
- `agentic-cli-authoring` when changing the Groundwork CLI surface
- `codex-configuration` for Codex `config.toml`, hooks, and trust behavior
- `opencode-plugin-authoring` for OpenCode plugin/hook behavior

## Output Pattern

When using this skill, produce:

1. Workspace classification and current Groundwork coverage.
2. A short file/config plan.
3. Setup or repair changes in dependency order.
4. Verification commands or checks, grouped by foundation.
5. Optional next upgrades.

When auditing an existing workspace, report each foundation as **present**, **partial**, or **missing**.
