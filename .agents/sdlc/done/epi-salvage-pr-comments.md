# Salvage pr_comments into EPI provenance

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: epi-salvage-pr-comments

## Context

The old local `plugin/review` should not survive as its own plugin, but `pr_comments` is valuable. EPI already has provenance tools for PR and diff context. The goal is to fold PR comment retrieval and processing into EPI in a way that complements, rather than duplicates, `prov_pr_expand`.

## Acceptance Criteria

- [x] AC-1: Current `plugin/review/pr-comments.ts` behavior is inventoried, including GraphQL/API paths, filtering, output formats, and tests.
- [x] AC-2: EPI receives a provenance-aligned PR comments capability or a clear extension to `prov_pr_expand`.
- [x] AC-3: Actionable, resolved, review, thread, and issue comment distinctions are preserved where useful.
- [x] AC-4: Tests cover pagination, review-thread shape, missing reviews, and large-output behavior.
- [x] AC-5: Old `pr_comments` tool can be retired from the local review plugin.

## Notes

[2026-04-24]: This is the strongest salvage candidate from `plugin/review`.
[2026-04-24]: Completed during review-plugin fold-in. EPI now exposes PR comments through `prov_pr_materialize` and `prov_pr_expand` review context, backed by the salvaged `review/pr-comments.ts` manager. Existing tests cover `gh api --paginate` REST paths, review-thread shape, and local/remote fallback; this pass added explicit no-review and large-output bounding coverage. The old standalone `pr_comments` permission/plugin path is retired.
