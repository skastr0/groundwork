# Retire local review plugin after EPI salvage

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: epi-retire-local-review-plugin-after-salvage

## Context

After `pr_comments` and any worthwhile local-story behavior are handled, the old local `plugin/review` should be removed. Branch/diff/PR context should come from EPI provenance or generic CLI surfaces, not a separate local plugin.

## Acceptance Criteria

- [ ] AC-1: `pr_comments` has landed in EPI or has been explicitly rejected.
- [ ] AC-2: `local_story_*` behavior has been retained elsewhere or explicitly retired.
- [ ] AC-3: `branch_*` tools are mapped to EPI provenance equivalents or retired.
- [ ] AC-4: Local `plugin/review*` source is deleted.
- [ ] AC-5: Stale review tool permissions are pruned from `opencode.json`.

## Notes

[2026-04-24]: This item closes the review-plugin cleanup after salvage decisions are complete.
