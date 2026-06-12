# Changelog

## 0.2.1

- Adds Git-backed policy pack install/update commands for reusable Groundwork policies.
- Adds `.groundwork/policies/*.toml` as the publish convention for policy packs.
- Ships `groundwork-effect` as a bundled policy pack and restores root plugin activation.
- Keeps Codex hook failures from surfacing as failed hook processes while preserving JSON feedback.
- Hardens policy pack installs against stale caches, source/lock drift, symlinked pack files, unsafe Git arguments, and transitive references in v1 packs.
- Documents the policy pack distribution flow and the hook-time no-network invariant.

## 0.2.0

- Adds block-once destructive-command risk handling so risky shell commands are blocked on first match, then allowed as an audited warning on an exact retry.
- Wires block-once behavior through the CLI, Codex hook package, and OpenCode runtime wrapper with session-scoped execution reporting.
- Requires `call_id` for public `risk evaluate-tool-call` requests so retry warnings can be paired with post-tool execution reports.
- Fixes risk `cwd` fingerprinting for relative CLI inputs by anchoring them to `root_dir`.
- Clarifies Codex/OpenCode risk feedback messages and documents the block-once lifecycle.

## 0.1.1

- Adds a Codex marketplace catalog so the Groundwork plugin can be installed from the repository root.
- Bundles the Codex hook runtime in the plugin source so Git-backed marketplace snapshots install without a local build step.
- Documents local and Git-backed Codex marketplace installation commands.

## 0.1.0

- Initial preview release target for the Groundwork CLI and Codex/OpenCode integration package.
- Establishes npm package identity as `@skastr0/groundwork` with the `groundwork` binary command.
- Documents release gates, support boundaries, security reporting, and public contribution expectations.
