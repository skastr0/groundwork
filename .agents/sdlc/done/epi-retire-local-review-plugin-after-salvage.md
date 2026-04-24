# Retire local review plugin after EPI salvage

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: epi-retire-local-review-plugin-after-salvage

## Context

After `pr_comments` and any worthwhile local-story behavior are handled, the old local `plugin/review` should be removed. Branch/diff/PR context should come from EPI provenance or generic CLI surfaces, not a separate local plugin.

## Acceptance Criteria

- [x] AC-1: `pr_comments` has landed in EPI or has been explicitly rejected.
- [x] AC-2: `local_story_*` behavior has been retained elsewhere or explicitly retired.
- [x] AC-3: `branch_*` tools are mapped to EPI provenance equivalents or retired.
- [x] AC-4: Local `plugin/review*` source is deleted.
- [x] AC-5: Stale review tool permissions are pruned from `opencode.json`.

## Notes

[2026-04-24]: This item closes the review-plugin cleanup after salvage decisions are complete.
[2026-04-24]: Completed by folding `pr_comments` into EPI PR provenance, explicitly deferring `local_story_*`, rejecting `pr_to_work_items` as-is, retiring `branch_*` in favor of `prov_repo_state`, `prov_diff_expand`, `prov_commit_expand`, `prov_pr_expand`, and `prov_worktree_overview`, pruning stale permissions, and deleting local `plugin/review*` source.
