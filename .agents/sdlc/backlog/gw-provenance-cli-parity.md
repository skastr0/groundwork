# Groundwork provenance CLI parity

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-provenance-cli-parity

## Context

The initial CLI only covers `gw_repo_state` and `gw_file_state`. The OpenCode plugin exposes a larger `gw_*` provenance surface that needs explicit CLI equivalents or documented downgrades.

## Acceptance Criteria

- [ ] AC-1: Add CLI commands and schemas for every registered `gw_*` tool not covered by the CLI foundation.
- [ ] AC-2: Preserve output parity for existing OpenCode query, lineage, expand, score, and read tools.
- [ ] AC-3: Decide and document whether `gw_block_read` stays blocking, becomes policy-backed, or is downgraded.
- [ ] AC-4: Add tests comparing representative OpenCode tool results with CLI command results.
- [ ] AC-5: Update capabilities, schemas, and examples for the full provenance command surface.

## Notes

[2026-05-03]: Tool inventory comes from `src/provenance/registry.ts`.
