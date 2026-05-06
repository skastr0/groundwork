# Groundwork PR comment states refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-pr-comment-states-refactor

## Context

`taste score --signal TS-LD-02 .` reports `review/pr-comments.ts` `fetchCommentStatesViaGraphQL` as the top function-size/local-reasoning hotspot at 128 LOC. The function mixes query text, pagination guard state, command construction, JSON parsing, thread comment ID collection, nested thread-comment pagination, state-map mutation, page cursor advancement, and error envelope creation.

## Acceptance Criteria

- [x] AC-1: Split `fetchCommentStatesViaGraphQL` into focused GraphQL pagination, parsing, command, and state-map helpers without changing public `PRCommentsManager` behavior.
- [x] AC-2: Preserve PR thread pagination limits, repeated cursor detection, parse errors, nested thread comment pagination, warning behavior for nested fetch failures, and comment state mapping.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `fetchCommentStatesViaGraphQL` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted PR comment-state validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `ca18084`; top diagnostic is `fetchCommentStatesViaGraphQL` at 128 LOC.
[2026-05-06]: Split review-thread query, command construction, page parsing, state mapping, and nested comment-id collection into helpers. Added direct PR comments tests for successful nested pagination, repeated review-thread cursors, parse failures, and nested pagination warning fallback. Targeted `bun run typecheck`, `bun run test src/tests/pr-comments.test.ts --reporter=verbose`, and `taste score --signal TS-LD-02 .` passed; the taste report no longer lists `fetchCommentStatesViaGraphQL`.
[2026-05-06]: Full `bun run verify` passed with 27 files / 256 tests plus build/import/CLI/local-install checks.
[2026-05-06]: Review follow-up fixed two findings: restored fresh `CommentState` object allocation per comment ID and added direct coverage for the 50-page GraphQL review-thread pagination limit. Tightened parse-failure coverage to the exact error envelope. Full `bun run verify` passed with 27 files / 257 tests plus build/import/CLI/local-install checks.
