# Groundwork provenance CLI parity

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-provenance-cli-parity

## Context

The initial CLI only covers `gw_repo_state` and `gw_file_state`. The OpenCode plugin exposes a larger `gw_*` provenance surface that needs explicit CLI equivalents or documented downgrades.

## Acceptance Criteria

- [x] AC-1: Add CLI commands and schemas for every registered `gw_*` tool not covered by the CLI foundation.
- [x] AC-2: Preserve output parity for existing OpenCode query, lineage, expand, score, and read tools.
- [x] AC-3: Decide and document whether `gw_block_read` stays blocking, becomes policy-backed, or is downgraded.
- [x] AC-4: Add tests comparing representative OpenCode tool results with CLI command results.
- [x] AC-5: Update capabilities, schemas, and examples for the full provenance command surface.

## Notes

[2026-05-03]: Tool inventory comes from `src/provenance/registry.ts`.
[2026-05-03]: Implemented `groundwork provenance run` for arbitrary `gw_*` registry tools and direct `groundwork provenance <tool-name>` commands for the remaining registry. Existing `repo-state` and `file-state` ergonomic commands stay stable; full registry-shaped results for those tools are available through `provenance run`.
[2026-05-03]: `gw_block_read` stays an explicit blocking provenance command (`groundwork provenance block-read`) rather than becoming a hidden policy side effect.
[2026-05-03]: Verification passed with `bun run verify`.
[2026-05-03]: Review found broad direct-command schemas and insufficient registry parity assertions. Follow-up commit tightened direct schemas and added representative CLI-vs-registry comparisons.
