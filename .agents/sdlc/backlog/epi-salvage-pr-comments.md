# Salvage pr_comments into EPI provenance

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: epi-salvage-pr-comments

## Context

The old local `plugin/review` should not survive as its own plugin, but `pr_comments` is valuable. EPI already has provenance tools for PR and diff context. The goal is to fold PR comment retrieval and processing into EPI in a way that complements, rather than duplicates, `prov_pr_expand`.

## Acceptance Criteria

- [ ] AC-1: Current `plugin/review/pr-comments.ts` behavior is inventoried, including GraphQL/API paths, filtering, output formats, and tests.
- [ ] AC-2: EPI receives a provenance-aligned PR comments capability or a clear extension to `prov_pr_expand`.
- [ ] AC-3: Actionable, resolved, review, thread, and issue comment distinctions are preserved where useful.
- [ ] AC-4: Tests cover pagination, review-thread shape, missing reviews, and large-output behavior.
- [ ] AC-5: Old `pr_comments` tool can be retired from the local review plugin.

## Notes

[2026-04-24]: This is the strongest salvage candidate from `plugin/review`.
