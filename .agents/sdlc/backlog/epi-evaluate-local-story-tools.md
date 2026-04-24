# Evaluate local_story review tools for EPI

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: epi-evaluate-local-story-tools

## Context

The old review plugin includes `local_story_collect` and `local_story_codestory`. These may overlap with EPI provenance, local evidence, and trace storage. They should be evaluated before copying code.

## Acceptance Criteria

- [ ] AC-1: Identify which local story behavior is distinct from existing EPI provenance/local-evidence tools.
- [ ] AC-2: Decide whether local story belongs in EPI, a generic CLI, or should be retired.
- [ ] AC-3: If retained, create a follow-up work item with a concrete canonical shape.
- [ ] AC-4: If retired, document why EPI provenance covers the need.

## Notes

[2026-04-24]: Do not migrate by default. Compare behavior first.
[2026-04-24]: Deferred redesign, not migrated in the review-plugin cleanup. `local_story_collect` and `local_story_codestory` braid local branch diff collection, trace/message/work-item linking, and artifact writing. EPI already owns the canonical primitives separately through `prov_worktree_overview`, `prov_pr_expand`, local evidence, and trace/message/work-item sources. Any future local-story capability should be designed as a provenance report over those primitives rather than copied from the old plugin.
